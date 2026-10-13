require('dotenv').config();
const jwt = require('jsonwebtoken');
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const cors = require('cors');
const crypto = require('crypto');         // built into Node — no install needed
const nodemailer = require('nodemailer'); // npm install nodemailer
const multer = require('multer');         // npm install multer — handles the photo upload
const path = require('path');             // built into Node — no install needed
const fs = require('fs');                 // built into Node — no install needed
const os = require('os');                 // built into Node — no install needed
const User = require('./models/User');
const Class = require('./models/Class');
const Subject = require('./models/Subject');
const Student = require('./models/Student');
const Grade = require('./models/Grade');
const { syncTeacherRoles, requireTeacher, validateId, invalid } = require('./services/teacher-roles');

const app = express();
app.use(cors());
app.use(express.json());

// ---------- Only allow requests from the same Wi-Fi network as this server ----------
// This used to hardcode one Wi-Fi's address range, which broke the moment the
// computer joined a different network. Now it asks the computer running this
// server which network(s) it is connected to RIGHT NOW, and only lets in
// devices on one of those same networks. Move to another Wi-Fi and it adapts
// by itself - nothing here needs editing. Devices outside (a different network,
// or anyone on the internet) are still rejected.

// Turns "192.168.1.30" into one plain number, so addresses can be compared.
function ipToNumber(ip) {
  return ip.split('.').reduce(function (total, octet) {
    return (total << 8) + Number(octet);
  }, 0) >>> 0;
}

function isOnAllowedNetwork(ip) {
  if (!ip) return false;

  // Requests made from this same computer look like these - always allow those.
  if (ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1') return true;

  const cleaned = ip.replace('::ffff:', ''); // Node sometimes adds this prefix to IPv4 addresses
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(cleaned)) return false;

  const clientNumber = ipToNumber(cleaned);
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      const isIPv4 = iface.family === 'IPv4' || iface.family === 4;
      if (!isIPv4 || iface.internal) continue;

      // A device is on the same network when, after hiding the "host" part
      // of both addresses with the subnet mask, what's left is identical.
      const mask = ipToNumber(iface.netmask);
      if ((clientNumber & mask) === (ipToNumber(iface.address) & mask)) return true;
    }
  }

  return false;
}

app.use(function (req, res, next) {
  if (!isOnAllowedNetwork(req.ip)) {
    return res.status(403).json({ error: 'This server is only reachable from its home Wi-Fi network.' });
  }
  next();
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB successfully!');
  })
  .catch((error) => {
    console.log('Oh no, something went wrong connecting to MongoDB:');
    console.log(error);
  });

// Used by /forget-password below to actually send the reset email through Gmail
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

// ---------- Profile photo uploads ----------
// Make sure the folder we're about to save photos into actually exists -
// multer will not create missing folders on its own.
const avatarsDir = path.join(__dirname, 'uploads', 'avatars');
fs.mkdirSync(avatarsDir, { recursive: true });

// Serve uploaded photos as plain files, e.g. GET /uploads/avatars/abc123.jpg
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, avatarsDir);
    },
    filename: function (req, file, cb) {
      // Name the file after the logged-in user, so a re-upload just replaces
      // the old one instead of piling up unused files forever.
      const ext = path.extname(file.originalname);
      cb(null, req.user.userId + '-' + Date.now() + ext);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max
  fileFilter: function (req, file, cb) {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed.'));
    }
    cb(null, true);
  }
});

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
  return res.status(403).json({ error: 'This account has been deactivated. Contact your admin.' });
    }

    // 2. Compare the typed password with the hashed one in the database
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }


  // 3. Create the "wristband" (JWT token) - now includes the role! 
  // Checked "remember me"? Give it a much longer expiry (30 days) instead of 1 hour.
  // Resolve the workspace before returning login, so the browser opens it directly.
  const isAdviser = user.role === 'teacher' && Boolean(await Class.exists({ adviser: user._id }));
  const token = jwt.sign(
    { userId: user._id, username: user.username, role: user.role, isAdviser },
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
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    // Respond the same way whether or not the email exists - this stops the
    // route from being used to check who has an account and who doesn't.
    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

      user.resetTokenHash = tokenHash;
      user.resetTokenExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now
      await user.save();

      const resetLink = `${process.env.FRONTEND_URL}/reset-password.html?token=${rawToken}`;

      try {
        await transporter.sendMail({
          from: `"Hope Grade Website" <${process.env.GMAIL_USER}>`,
          to: email,
          subject: 'Reset your password',
          html: `<p>Click the link below to reset your password. It expires in 15 minutes.</p>
                 <p><a href="${resetLink}">${resetLink}</a></p>
                 <p>If you didn't request this, you can ignore this email.</p>`
        });
      } catch (emailError) {
        console.log('Failed to send reset email:');
        console.log(emailError);
      }
    }

    res.json({ message: 'If an account exists for that email, a reset link has been sent.' });

  } catch (error) {
    console.log('Something went wrong during forget-password:');
    console.log(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password || password.length < 8) {
      return res.status(400).json({ error: 'A valid token and an 8+ character password are required.' });
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

app.listen(3000, () => {
  console.log('Server is running at http://localhost:3000');
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
    const user = await User.findById(req.user.userId).select('-password -resetTokenHash -resetTokenExpiry');
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
app.post('/me/photo', verifyToken, avatarUpload.single('photo'), async (req, res) => {
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
      return res.status(400).json({ error: 'New password must include at least one letter and one number.' });
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
      return res.status(400).json({ error: 'New password must be different from your current password.' });
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
          teacherRoles: [advisoryClass && 'class-advisor', subjectsTaught.length && 'subject-teacher'].filter(Boolean),
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
    await newTeacher.save();

    res.json({ message: `Teacher account created for ${username}.` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.use('/admin/teachers', require('./routes/teacher-roles'));

// Toggle a teacher's active/deactivated status
app.patch('/admin/teachers/:id/deactivate', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const teacher = await User.findById(req.params.id);

    if (!teacher) {
      return res.status(404).json({ error: 'Teacher not found.' });
    }

    teacher.isActive = !teacher.isActive;
    await teacher.save();

    res.json({ message: `${teacher.username} is now ${teacher.isActive ? 'active' : 'deactivated'}.` });
  } catch (error) {
    res.status(500).json({ error: 'Something went wrong.' });
  }
});


// Create a new class and assign its adviser
app.post('/admin/classes', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { name, adviserId, gradeLevel, section } = req.body;
    let newClass;
    await mongoose.connection.transaction(async session => {
      if (adviserId) {
        await requireTeacher(adviserId, session);
        if (await Class.exists({ adviser: adviserId }).session(session)) invalid('This teacher already has a homeroom. Change it through Assign Roles.', 409);
      }
      newClass = new Class({ name, adviser: adviserId || null, gradeLevel: gradeLevel || '', section: section || '' });
      await newClass.save({ session });
      await syncTeacherRoles(adviserId, session);
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
    const result = await require('./services/section-subjects').save(req.user, req.body.classId, null, req.body);
    res.json({ message: 'Subject assigned.', ...result });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not create subject.' });
  }
});

// List all subjects, with their teacher and class info attached
app.get('/admin/subjects', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const subjects = await Subject.find()
      .populate('teacher', 'username')
      .populate('class', 'name');
    res.json(subjects);
  } catch (error) {
    res.status(500).json({ error: 'Something went wrong fetching subjects.' });
  }
});

app.use(require('./routes/academic'));
app.use('/section-subjects', require('./routes/section-subjects'));
