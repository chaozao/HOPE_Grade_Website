require('dotenv').config();
const jwt = require('jsonwebtoken');
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const cors = require('cors');
const crypto = require('crypto');         // built into Node — no install needed
const nodemailer = require('nodemailer'); // npm install nodemailer
const User = require('./models/User');
const Class = require('./models/Class');
const Subject = require('./models/Subject');
const Student = require('./models/Student');
const Grade = require('./models/Grade');

const app = express();
app.use(cors());
app.use(express.json());

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
    const user = await User.findOne({ email });

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
  const token = jwt.sign(
    { userId: user._id, username: user.username, role: user.role },
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
    const { name, adviserId } = req.body;

    const newClass = new Class({ name, adviser: adviserId });
    await newClass.save();

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
    const { name, classId, teacherId } = req.body;

    const newSubject = new Subject({ name, class: classId, teacher: teacherId });
    await newSubject.save();

    res.json({ message: `Subject "${name}" assigned.`, subject: newSubject });
  } catch (error) {
    res.status(400).json({ error: error.message });
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

// A Class Adviser views THEIR OWN class: roster + subjects + subject teachers
app.get('/adviser/my-class', verifyToken, requireRole('teacher'), async (req, res) => {
  try {
    const myClass = await Class.findOne({ adviser: req.user.userId });

    if (!myClass) {
      return res.status(404).json({ error: 'You are not currently assigned as a Class Adviser.' });
    }

    const students = await Student.find({ class: myClass._id })
      .collation({ locale: 'en', strength: 2 })
      .sort({ lastName: 1, firstName: 1 });

    const subjects = await Subject.find({ class: myClass._id }).populate('teacher', 'username email');

    res.json({ class: myClass, students, subjects });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// A Class Adviser adds a student - ALWAYS goes into their own class, never someone else's
app.post('/adviser/students', verifyToken, requireRole('teacher'), async (req, res) => {
  try {
    const myClass = await Class.findOne({ adviser: req.user.userId });

    if (!myClass) {
      return res.status(403).json({ error: 'You are not a Class Adviser.' });
    }

    const { lastName, firstName, middleInitial, gender } = req.body;

    const newStudent = new Student({
      lastName,
      firstName,
      middleInitial,
      gender,
      class: myClass._id  // forced - can't add students to a class you don't advise
    });
    await newStudent.save();

    res.json({ message: `Student "${firstName} ${lastName}" added to ${myClass.name}.`, student: newStudent });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// A Subject Teacher sees all subjects THEY teach
app.get('/teacher/my-subjects', verifyToken, requireRole('teacher'), async (req, res) => {
  try {
    const subjects = await Subject.find({ teacher: req.user.userId }).populate('class', 'name');

    const subjectsWithCounts = await Promise.all(
      subjects.map(async (subject) => {
        const studentCount = await Student.countDocuments({ class: subject.class._id });
        return {
          _id: subject._id,
          name: subject.name,
          className: subject.class.name,
          classId: subject.class._id,
          studentCount
        };
      })
    );

    res.json(subjectsWithCounts);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Something went wrong fetching your subjects.' });
  }
});

// Small helper: turns 4 raw scores into a weighted percentage (or null if incomplete)
function computeWeightedGrade(scores) {
  const { hw1, quiz1, midterm, project1 } = scores;

  if (hw1 == null || quiz1 == null || midterm == null || project1 == null) {
    return null; // not fully graded yet
  }

  const weightedSum = (hw1 * 0.15) + (quiz1 * 0.20) + (midterm * 0.30) + (project1 * 0.15);
  return Number((weightedSum / 0.80).toFixed(1));
}

// A Subject Teacher sees the roster + current grades for ONE of their subjects
app.get('/teacher/subjects/:id/roster', verifyToken, requireRole('teacher'), async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.id);

    if (!subject) {
      return res.status(404).json({ error: 'Subject not found.' });
    }

    // Security check - can this teacher actually see THIS subject?
    if (subject.teacher.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'This is not your subject.' });
    }

    const students = await Student.find({ class: subject.class })
      .collation({ locale: 'en', strength: 2 })
      .sort({ lastName: 1, firstName: 1 });

    const roster = await Promise.all(
      students.map(async (student) => {
        let grade = await Grade.findOne({ student: student._id, subject: subject._id });

        if (!grade) {
          // No grade record yet - create an empty one so the frontend has something to show/edit
          grade = await Grade.create({ student: student._id, subject: subject._id, scores: {} });
        }

        return {
          studentId: student._id,
          lastName: student.lastName,
          firstName: student.firstName,
          scores: grade.scores,
          weightedGrade: computeWeightedGrade(grade.scores)
        };
      })
    );

    const gradedCount = roster.filter((r) => r.weightedGrade !== null).length;
    const passingCount = roster.filter((r) => r.weightedGrade !== null && r.weightedGrade >= 75).length;
    const classAverage = gradedCount > 0
      ? Number((roster.reduce((sum, r) => sum + (r.weightedGrade || 0), 0) / gradedCount).toFixed(1))
      : null;

    res.json({
      subjectName: subject.name,
      totalStudents: roster.length,
      classAverage,
      passingRate: gradedCount > 0 ? Number(((passingCount / gradedCount) * 100).toFixed(1)) : null,
      roster
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Something went wrong fetching the roster.' });
  }
});

// A Subject Teacher saves grades for their own subject
app.put('/teacher/subjects/:id/grades', verifyToken, requireRole('teacher'), async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.id);

    if (!subject) {
      return res.status(404).json({ error: 'Subject not found.' });
    }

    if (subject.teacher.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'This is not your subject.' });
    }

    const { grades } = req.body; // array of { studentId, scores: { hw1, quiz1, midterm, project1 } }

    for (const entry of grades) {
      await Grade.findOneAndUpdate(
        { student: entry.studentId, subject: subject._id },
        { scores: entry.scores },
        { upsert: true, new: true, runValidators: true }
      );
    }

    res.json({ message: 'Grades saved successfully.' });
  } catch (error) {
    console.log(error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/teacher/subjects/:id/insights', verifyToken, requireRole('teacher'), async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.id).populate('class', 'name');

    if (!subject) {
      return res.status(404).json({ error: 'Subject not found.' });
    }

    if (subject.teacher.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'This is not your subject.' });
    }

    const students = await Student.find({ class: subject.class._id })
      .collation({ locale: 'en', strength: 2 })
      .sort({ lastName: 1, firstName: 1 });

    const distribution = { A: 0, B: 0, C: 0, F: 0, notGraded: 0 };
    const atRisk = [];
    const componentSums = { hw1: 0, quiz1: 0, midterm: 0, project1: 0 };
    const componentCounts = { hw1: 0, quiz1: 0, midterm: 0, project1: 0 };

    for (const student of students) {
      let grade = await Grade.findOne({ student: student._id, subject: subject._id });
      const scores = grade ? grade.scores : {};

      ['hw1', 'quiz1', 'midterm', 'project1'].forEach(function (field) {
        if (scores[field] != null) {
          componentSums[field] += scores[field];
          componentCounts[field] += 1;
        }
      });

      const weighted = computeWeightedGrade(scores);

      if (weighted === null) {
        distribution.notGraded += 1;
      } else if (weighted >= 90) {
        distribution.A += 1;
      } else if (weighted >= 80) {
        distribution.B += 1;
      } else if (weighted >= 75) {
        distribution.C += 1;
      } else {
        distribution.F += 1;
      }

      if (weighted !== null && weighted < 75) {
        atRisk.push({
          studentId: student._id,
          name: student.firstName + ' ' + student.lastName,
          weightedGrade: weighted
        });
      }
    }

    const componentAverages = {};
    ['hw1', 'quiz1', 'midterm', 'project1'].forEach(function (field) {
      componentAverages[field] = componentCounts[field] > 0
        ? Number((componentSums[field] / componentCounts[field]).toFixed(1))
        : null;
    });

    atRisk.sort(function (a, b) { return a.weightedGrade - b.weightedGrade; });

    res.json({
      subjectName: subject.name,
      className: subject.class.name,
      totalStudents: students.length,
      distribution,
      componentAverages,
      atRisk
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Something went wrong generating insights.' });
  }
});