require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const jwt = require('jsonwebtoken');
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const cors = require('cors');
const crypto = require('crypto'); // built into Node — no install needed
const { createPasswordMail, logMailError } = require('./services/password-mail');
const createAvatarUpload = require('./middleware/avatar-upload');
const path = require('path'); // built into Node — no install needed
const User = require('./models/User');
const Class = require('./models/Class');
const Subject = require('./models/Subject');
const Student = require('./models/Student');
const Grade = require('./models/Grade');
const adminHistory = require('./services/admin-history');
const {
  syncTeacherRoles,
  requireTeacher,
  validateId,
  invalid
} = require('./services/teacher-roles');

const app = express();
app.use(cors());
app.use(express.json());

// Handle the Z.com application URL prefix
app.use((req, res, next) => {
  if (req.url === '/grading-api') {
    req.url = '/';
  } else if (req.url.startsWith('/grading-api/')) {
    req.url = req.url.slice('/grading-api'.length);
  }
  next();
});

app.get('/', (req, res) => {
  res.json({
    message: 'HOPE Gradebook API is running!',
    status: 'success'
  });
});

app.get('/grading-api', (req, res) => {
  res.json({
    message: 'HOPE Gradebook API is running!',
    status: 'success'
  });
});

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB successfully!');
  })
  .catch((error) => {
    console.log('Oh no, something went wrong connecting to MongoDB:');
    console.log(error);
  });

// Uploads are stored on the hosting server, beneath this backend folder.
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
const avatarUpload = createAvatarUpload(path.join(__dirname, 'uploads', 'avatars'));

app.post('/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({ username, email, password: hashedPassword });

    await newUser.save();

    console.log('New user saved to database:', newUser);
    res.json({ message: `Thank you for signing up, ${username}!` });
  } catch (error) {
    console.log('Something went wrong while saving the user:');
    console.log(error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password, remember } = req.body;

    // 1. Find the user by their email
    // .select('+password') is needed here because the schema now hides the
    // password field by default (see User.js) - this route is one of the
    // few that genuinely needs to read the hash, to compare it below.
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }
    if (!user.isActive) {
      return res
        .status(403)
        .json({ error: 'This account has been deactivated. Contact your admin.' });
    }

    // 2. Compare the typed password with the hashed one in the database
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    // 3. Create the "wristband" (JWT token) - now includes the role!
    // Checked "remember me"? Give it a much longer expiry (30 days) instead of 1 hour.
    // Resolve the workspace before returning login, so the browser opens it directly.
    const [advisory, teaching] = user.role === 'teacher'
      ? await Promise.all([
          Class.exists({ adviser: user._id }),
          Subject.exists({ teacher: user._id })
        ])
      : [null, null];
    const isAdviser = Boolean(advisory);
    const token = jwt.sign(
      { userId: user._id, username: user.username, role: user.role, isAdviser, hasTeaching: Boolean(teaching) },
      process.env.JWT_SECRET,
      { expiresIn: remember ? '30d' : '1h' }
    );

    // 4. Send the wristband back to the user
    res.json({
      message: `Welcome back, ${user.username}!`,
      token: token
    });
  } catch (error) {
    console.log('Something went wrong during login:');
    console.log(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------- Forgot password flow ----------

app.post('/forget-password', async (req, res) => {
  const email = req.body && req.body.email;
  if (typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: 'Enter your email address.' });
  }

  let mail;
  try {
    mail = createPasswordMail();
    // Check infrastructure before looking up the account. An SMTP outage
    // returns the same response for registered and unregistered addresses.
    await mail.verify();
  } catch (error) {
    logMailError(error);
    return res.status(503).json({ error: 'Password reset email is temporarily unavailable. Please try again later or contact the administrator.' });
  }

  try {
    const user = await User.findOne({ email: email.trim() });
    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      user.resetTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      user.resetTokenExpiry = new Date(Date.now() + 15 * 60 * 1000);
      await user.save();
      try {
        await mail.send(user.email, rawToken);
      } catch (error) {
        // Recipient-specific delivery errors must not reveal account existence.
        // The hosting log records a safe code for the administrator instead.
        logMailError(error);
      }
    }
    res.json({ message: 'If an account exists for that email, a reset email has been requested. Check your inbox and spam folder.' });
  } catch (error) {
    console.error('[password-reset] ACCOUNT_UPDATE_FAILED');
    res.status(500).json({ error: 'Could not process the reset request. Please try again.' });
  }
});

app.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password || password.length < 8) {
      return res
        .status(400)
        .json({ error: 'A valid token and an 8+ character password are required.' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({ resetTokenHash: tokenHash });

    if (!user || !user.resetTokenExpiry || user.resetTokenExpiry.getTime() < Date.now()) {
      return res.status(400).json({ error: 'This link has expired or is invalid.' });
    }

    user.password = await bcrypt.hash(password, 10);
    user.resetTokenHash = null;
    user.resetTokenExpiry = null;
    await user.save();

    res.json({ message: 'Password updated.' });
  } catch (error) {
    console.log('Something went wrong during reset-password:');
    console.log(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});


const { verifyToken, requireRole } = require('./middleware/auth');

// A route ANYONE with a valid token can access (any role)
app.get('/profile', verifyToken, (req, res) => {
  res.json({ message: `Hello ${req.user.username}, you are a ${req.user.role}.` });
});

// ---------- Own account settings (name, photo, password) ----------

// Get your own full profile
app.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select(
      '-password -resetTokenHash -resetTokenExpiry'
    );
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// Change your own display name
app.put('/me', verifyToken, async (req, res) => {
  try {
    const { username } = req.body;

    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'Name cannot be empty.' });
    }

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { username: username.trim() },
      { returnDocument: 'after', runValidators: true }
    ).select('-password -resetTokenHash -resetTokenExpiry');

    res.json(user);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Upload/replace your own profile photo
app.post('/me/photo', verifyToken, avatarUpload, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No photo was uploaded.' });
    }

    const photoPath = '/uploads/avatars/' + req.file.filename;

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { photo: photoPath },
      { returnDocument: 'after' }
    ).select('-password -resetTokenHash -resetTokenExpiry');

    res.json(user);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Restore the default avatar for the signed-in account only.
app.delete('/me/photo', verifyToken, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { $unset: { photo: '' } },
      { returnDocument: 'after' }
    ).select('-password -resetTokenHash -resetTokenExpiry');
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Could not remove your profile photo. Please retry.' });
  }
});

// Change your own password (must prove you know the current one)
app.put('/me/password', verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // ---------- Sanitization ----------
    // Reject anything that isn't a plain string outright (e.g. someone
    // sending {"$ne": null} or an array instead of text) before it gets
    // anywhere near a database query or bcrypt.
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'Invalid request.' });
    }

    // Trim the NEW password only - stray whitespace pasted in by accident
    // shouldn't become part of a brand new credential. The CURRENT password
    // is deliberately left exactly as typed, so it's checked against
    // whatever is actually stored, whitespace and all.
    const trimmedNewPassword = newPassword.trim();

    // ---------- Validation ----------
    if (!currentPassword) {
      return res.status(400).json({ error: 'Current password is required.' });
    }
    if (trimmedNewPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }
    // bcrypt silently ignores anything past 72 characters - rejecting a
    // longer password here is more honest than letting someone believe
    // the extra length is adding protection when it quietly isn't.
    if (trimmedNewPassword.length > 72) {
      return res.status(400).json({ error: 'New password must be 72 characters or fewer.' });
    }
    if (!/[A-Za-z]/.test(trimmedNewPassword) || !/[0-9]/.test(trimmedNewPassword)) {
      return res
        .status(400)
        .json({ error: 'New password must include at least one letter and one number.' });
    }

    // .select('+password') is required here since the schema hides this
    // field by default now (see User.js) - this route is one of the few
    // that legitimately needs to read the hash, to compare it below.
    const user = await User.findById(req.user.userId).select('+password');
    const isMatch = await bcrypt.compare(currentPassword, user.password);

    if (!isMatch) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }

    const isSameAsBefore = await bcrypt.compare(trimmedNewPassword, user.password);
    if (isSameAsBefore) {
      return res
        .status(400)
        .json({ error: 'New password must be different from your current password.' });
    }

    user.password = await bcrypt.hash(trimmedNewPassword, 10);
    user.resetTokenHash = null;
    user.resetTokenExpiry = null;
    await user.save();

    res.json({ message: 'Password updated successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// List all teachers, along with their advisory class + subjects taught
app.get('/admin/teachers', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const teachers = await User.find({ role: 'teacher' }).select('-password');

    const teachersWithRoles = await Promise.all(
      teachers.map(async (teacher) => {
        const advisoryClass = await Class.findOne({ adviser: teacher._id });
        const subjectsTaught = await Subject.find({ teacher: teacher._id });

        return {
          _id: teacher._id,
          username: teacher.username,
          email: teacher.email,
          isActive: teacher.isActive,
          advisoryClass: advisoryClass ? advisoryClass.name : null,
          advisoryClassId: advisoryClass ? advisoryClass._id : null,
          subjectIds: subjectsTaught.map((s) => s._id),
          // Derive these for older accounts whose teacherRoles have not been saved yet.
          teacherRoles: [
            advisoryClass && 'class-advisor',
            subjectsTaught.length && 'subject-teacher'
          ].filter(Boolean),
          subjectsTaught: subjectsTaught.map((s) => s.name)
        };
      })
    );

    res.json(teachersWithRoles);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Something went wrong fetching teachers.' });
  }
});

// Admin manually creates a new teacher account
app.post('/admin/teachers', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    const newTeacher = new User({ username, email, password: hashedPassword, role: 'teacher' });
    await mongoose.connection.transaction(async session => {
      await newTeacher.save({ session });
      await adminHistory.record(req.user, 'Added teacher ' + username,
        [adminHistory.change('User', newTeacher)], session);
    });

    res.json({ message: `Teacher account created for ${username}.` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.use('/admin/teachers', require('./routes/teacher-roles'));
app.use('/admin/clear-data', require('./routes/clear-data'));
app.use('/admin/history', require('./routes/admin-history'));
app.use('/subject-leadership', require('./routes/subject-leadership'));

// Toggle a teacher's active/deactivated status
app.patch('/admin/teachers/:id/deactivate', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id))
      return res.status(400).json({ error: 'Invalid teacher ID.' });
    if (req.body.isActive !== undefined && typeof req.body.isActive !== 'boolean') {
      return res.status(400).json({ error: 'Account status must be true or false.' });
    }
    let teacher;
    await mongoose.connection.transaction(async session => {
      teacher = await User.findOne({ _id: req.params.id, role: 'teacher' }).session(session);
      if (!teacher) invalid('Teacher not found.', 404);
      const before = adminHistory.snapshot('User', teacher);
      teacher.isActive = req.body.isActive === undefined ? !teacher.isActive : req.body.isActive;
      await teacher.save({ session });
      await adminHistory.record(req.user,
        (teacher.isActive ? 'Activated teacher ' : 'Deactivated teacher ') + teacher.username,
        [adminHistory.change('User', teacher, before)], session);
    });

    res.json({
      message: `${teacher.username} is now ${teacher.isActive ? 'active' : 'deactivated'}.`
    });
  } catch (error) {
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// Create a new class and assign its adviser
app.post('/admin/classes', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { name, adviserId, gradeLevel, section } = req.body;
    let newClass;
    await mongoose.connection.transaction(async (session) => {
      if (adviserId) {
        await requireTeacher(adviserId, session);
        if (await Class.exists({ adviser: adviserId }).session(session))
          invalid('This teacher already has a homeroom. Change it through Assign Roles.', 409);
      }
      newClass = new Class({
        name,
        adviser: adviserId || null,
        gradeLevel: gradeLevel || '',
        section: section || ''
      });
      await newClass.save({ session });
      await syncTeacherRoles(adviserId, session);
      await adminHistory.record(req.user, 'Added class ' + name,
        [adminHistory.change('Class', newClass)], session);
    });

    res.json({ message: `Class "${name}" created.`, class: newClass });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// List all classes, with their adviser's info attached
app.get('/admin/classes', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const classes = await Class.find().populate('adviser', 'username email');
    res.json(classes);
  } catch (error) {
    res.status(500).json({ error: 'Something went wrong fetching classes.' });
  }
});

// Create a new subject and assign its teacher
app.post('/admin/subjects', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const result = await require('./services/section-subjects').save(
      req.user,
      req.body.classId,
      null,
      req.body
    );
    res.json({ message: 'Subject assigned.', ...result });
  } catch (error) {
    res
      .status(error.status || 500)
      .json({ error: error.status ? error.message : 'Could not create subject.' });
  }
});

// List all subjects, with their teacher and class info attached
app.get('/admin/subjects', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const subjects = await Subject.find().populate('teacher', 'username').populate('class', 'name');
    res.json(subjects);
  } catch (error) {
    res.status(500).json({ error: 'Something went wrong fetching subjects.' });
  }
});

app.use(require('./routes/academic'));
app.use('/section-subjects', require('./routes/section-subjects'));

// Start the Gradebook server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Gradebook API running on port ${PORT}`);
});
