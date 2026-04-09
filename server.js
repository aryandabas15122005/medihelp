const express = require('express');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

// ── MongoDB Connection ────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI, { 
    serverSelectionTimeoutMS: 10000 // 10 second timeout
})
.then(() => console.log('✅ [MONGODB] Connected to Atlas Cloud'))
.catch(err => {
    console.error('❌ [MONGODB] Connection Error:', err.message);
    console.log('TIP: Check if your IP address is whitelisted in MongoDB Atlas (Network Access).');
});

// ── Schemas ───────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
    identifier: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    name: { type: String, required: true },
    role: { type: String, enum: ['patient', 'doctor'], required: true },
    profile: { type: Object, default: {} }
});
const User = mongoose.model('User', UserSchema);

const AppointmentSchema = new mongoose.Schema({
    patientId: String,
    doctorId: String,
    doctorName: String,
    patientName: String,
    time: String,
    reason: String,
    status: { type: String, default: 'pending' }
});
const Appointment = mongoose.model('Appointment', AppointmentSchema);

const TicketSchema = new mongoose.Schema({
    patientId: String,
    doctorId: String,
    patientName: String,
    summary: String,
    chatLog: Array,
    status: { type: String, default: 'open' },
    doctorNote: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});
const Ticket = mongoose.model('Ticket', TicketSchema);

const OtpSchema = new mongoose.Schema({
    email: String,
    otp: String,
    expiresAt: Date
});
const Otp = mongoose.model('Otp', OtpSchema);


// ── Email Setup ──────────────────────────────────────────
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_PASS;

const emailEnabled = GMAIL_USER !== 'YOUR_GMAIL_HERE@gmail.com' && GMAIL_PASS !== 'YOUR_APP_PASSWORD_HERE';

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_PASS }
});

async function sendEmail(to, subject, text) {
    if (!emailEnabled) {
        console.log(`[Email SKIPPED - configure Gmail credentials]\nTo: ${to}\nSubject: ${subject}\n${text}\n`);
        return;
    }
    try {
        await transporter.sendMail({ 
            from: `"MediHelp Support" <${GMAIL_USER}>`, 
            to, 
            subject, 
            text 
        });
        console.log(`[Email SENT] To: ${to} | Subject: ${subject}`);
    } catch(err) {
        console.error('[Email ERROR]', err.message);
    }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/auth/send-otp', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        // Clear old OTPs for this email
        await Otp.deleteMany({ $or: [{ email }, { expiresAt: { $lt: new Date() } }] });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

        await Otp.create({ email, otp, expiresAt });

        const subject = `Your MediHelp Verification Code: ${otp}`;
        const body = `Hello,\n\nYour verification code for MediHelp is: ${otp}\n\nThis code will expire in 15 minutes.\n\nThank you,\nMediHelp Support`;
        
        sendEmail(email, subject, body);
        res.json({ success: true, message: 'OTP sent successfully' });
    } catch (e) {
        res.status(500).json({ error: 'Failed to send OTP' });
    }
});

app.post('/api/register', async (req, res) => {
    const { role, identifier, password, name, otp } = req.body;
    if (!role || !identifier || !password || !name || !otp) return res.status(400).json({ error: 'Missing fields' });
    
    try {
        // Verify OTP
        const otpRecord = await Otp.findOne({ email: identifier, otp, expiresAt: { $gt: new Date() } });
        if (!otpRecord) {
            return res.status(400).json({ error: 'Invalid or expired OTP code' });
        }

        const existingUser = await User.findOne({ identifier });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }
        
        const user = await User.create({ identifier, password, name, role, profile: {} });
        
        // Remove used OTP
        await Otp.deleteMany({ email: identifier });
        
        const userSafe = user.toObject();
        delete userSafe.password;
        userSafe.id = userSafe._id.toString();
        res.json({ success: true, user: userSafe });
    } catch (e) {
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/api/login', async (req, res) => {
    const { role, identifier, password } = req.body;
    if (!role || !identifier || !password) return res.status(400).json({ error: 'Missing fields' });
    
    try {
        const user = await User.findOne({ identifier, password, role });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const userSafe = user.toObject();
        delete userSafe.password;
        // Use MongoDB _id as id for frontend compatibility
        userSafe.id = userSafe._id.toString(); 
        res.json({ success: true, user: userSafe });
    } catch (e) {
        res.status(500).json({ error: 'Login failed' });
    }
});

app.get('/api/doctors', async (req, res) => {
    try {
        const doctors = await User.find({ role: 'doctor' }).select('-password');
        res.json(doctors.map(d => {
            const doc = d.toObject();
            doc.id = d._id.toString();
            return doc;
        }));
    } catch (e) {
        res.status(500).json({ error: 'Failed to load doctors' });
    }
});

app.get('/api/patients', async (req, res) => {
    try {
        const patients = await User.find({ role: 'patient' }).select('-password');
        res.json(patients.map(p => {
            const pat = p.toObject();
            pat.id = p._id.toString();
            return pat;
        }));
    } catch (e) {
        res.status(500).json({ error: 'Failed to load patients' });
    }
});

app.put('/api/profile', async (req, res) => {
    const { userId, profileData } = req.body;
    if (!userId || !profileData) return res.status(400).json({ error: 'Missing fields' });
    
    try {
        const user = await User.findByIdAndUpdate(
            userId, 
            { $set: { profile: profileData } }, 
            { new: true }
        ).select('-password');
        
        if (!user) return res.status(404).json({ error: 'User not found' });
        
        const userSafe = user.toObject();
        userSafe.id = userSafe._id.toString();
        res.json({ success: true, user: userSafe });
    } catch (e) {
        res.status(500).json({ error: 'Profile update failed' });
    }
});

app.get('/api/appointments', async (req, res) => {
    const { userId, role } = req.query;
    if (!userId || !role) return res.json([]);
    
    try {
        const filter = role === 'doctor' ? { doctorId: userId } : { patientId: userId };
        const appts = await Appointment.find(filter);
        res.json(appts.map(a => ({ ...a.toObject(), id: a._id.toString() })));
    } catch (e) {
        res.status(500).json({ error: 'Failed to load appointments' });
    }
});

app.post('/api/appointments', async (req, res) => {
    const { patientId, doctorId, time, reason } = req.body;
    if (!patientId || !doctorId || !time) return res.status(400).json({ error: 'Missing fields' });

    try {
        const patient = await User.findById(patientId);
        const doctor = await User.findById(doctorId);
        
        if (!patient || !doctor) return res.status(400).json({ error: 'Invalid users' });

        const appointment = await Appointment.create({ 
            patientId, doctorId, time, reason, 
            status: 'pending',
            patientName: patient.name,
            doctorName: doctor.name
        });

        const subject = 'Appointment Booked — MediHelp';
        const body = `Hello,\n\nA new consultation has been booked on MediHelp.\n\nPatient: ${patient.name}\nDoctor:  Dr. ${doctor.name}\nDate/Time: ${new Date(time).toLocaleString()}\nReason:  ${reason || 'Not specified'}\n\nStatus: Pending (awaiting doctor approval)\n\nLog in for details.\n\n— MediHelp Medical Portal`;
        
        // Safety: ensure email failure doesn't crash the booking
        sendEmail(`${patient.identifier},${doctor.identifier}`, subject, body).catch(e => console.error('[Email ERROR]', e.message));

        res.json({ success: true, appointment: { ...appointment.toObject(), id: appointment._id.toString() } });
    } catch (e) {
        console.error('[Booking ERROR]', e);
        res.status(500).json({ error: 'Booking failed. Please check server logs.' });
    }
});

app.post('/api/appointments/status', async (req, res) => {
    const { appointmentId, status } = req.body;
    if (!appointmentId || !status) return res.status(400).json({ error: 'Missing fields' });
    
    try {
        const appt = await Appointment.findByIdAndUpdate(appointmentId, { status }, { new: true });
        if (!appt) return res.status(404).json({ error: 'Appointment not found' });
        
        const patient = await User.findById(appt.patientId);
        const doctor  = await User.findById(appt.doctorId);
        if (patient && doctor) {
            const label = status === 'approved' ? 'APPROVED ✓' : 'DECLINED ✕';
            const body = `Hello ${patient.name},\n\nYour appointment request with Dr. ${doctor.name} has been ${label}.\n\nDate/Time: ${new Date(appt.time).toLocaleString()}\nReason: ${appt.reason}\n\nLog in to view details.\n\n— MediHelp Medical Portal`;
            sendEmail(patient.identifier, `Appointment ${label} — MediHelp`, body);
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Status update failed' });
    }
});


// ── Tickets (chatbot escalations) ─────────────────────
app.post('/api/tickets', async (req, res) => {
    const { patientId, doctorId, summary, chatLog } = req.body;
    if (!patientId || !summary) return res.status(400).json({ error: 'Missing fields' });
    
    try {
        const patient = await User.findById(patientId);
        if (!patient) return res.status(404).json({ error: 'Patient not found' });
        
        const ticket = await Ticket.create({
            patientId, 
            doctorId: doctorId || null,
            patientName: patient.name,
            summary, chatLog: chatLog || [],
            status: 'open'
        });

        // Email the doctor if doctorId provided
        if (doctorId) {
            const doctor = await User.findById(doctorId);
            if (doctor) {
                const body = `Hello Dr. ${doctor.name},\n\nA patient (${patient.name}) has raised a health query.\n\nSUMMARY:\n${summary}\n\nPlease review.\n\n— MediHelp Health Assistant`;
                sendEmail(doctor.identifier, `Health Query Ticket from ${patient.name} — MediHelp`, body);
            }
        }
        res.json({ success: true, ticket: { ...ticket.toObject(), id: ticket._id.toString() } });
    } catch (e) {
        res.status(500).json({ error: 'Ticket creation failed' });
    }
});
app.get('/api/tickets', async (req, res) => {
    const { doctorId, patientId } = req.query;
    try {
        let filter = {};
        if (doctorId) filter = { $or: [{ doctorId }, { doctorId: null }] };
        if (patientId) filter = { patientId };
        
        const tickets = await Ticket.find(filter).sort({ createdAt: -1 });
        res.json(tickets.map(t => ({ ...t.toObject(), id: t._id.toString() })));
    } catch (e) {
        res.status(500).json({ error: 'Failed to load tickets' });
    }
});

app.patch('/api/tickets/:id', async (req, res) => {
    const { status, doctorNote } = req.body;
    try {
        const update = {};
        if (status) update.status = status;
        if (doctorNote) update.doctorNote = doctorNote;
        
        const ticket = await Ticket.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
        if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Ticket update failed' });
    }
});

app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
