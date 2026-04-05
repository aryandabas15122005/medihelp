const express = require('express');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ patients: [], doctors: [], appointments: [], prescriptions: [] }));
}

// Ensure old DBs have the new arrays
const ensureDb = () => {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    let changed = false;
    if (!db.appointments) { db.appointments = []; changed = true; }
    if (!db.prescriptions) { db.prescriptions = []; changed = true; }
    if (!db.tickets) { db.tickets = []; changed = true; }
    if (changed) fs.writeFileSync(DB_FILE, JSON.stringify(db));
};
ensureDb();

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

app.post('/api/register', (req, res) => {
    const { role, identifier, password, name } = req.body;
    if (!role || !identifier || !password || !name) return res.status(400).json({ error: 'Missing fields' });
    
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const table = role === 'doctor' ? db.doctors : db.patients;
    
    if (table.find(u => u.identifier === identifier)) {
        return res.status(400).json({ error: 'User already exists' });
    }
    
    const user = { id: Date.now().toString(), identifier, password, name, role, profile: {} };
    table.push(user);
    fs.writeFileSync(DB_FILE, JSON.stringify(db));
    
    const userSafe = { ...user };
    delete userSafe.password;
    res.json({ success: true, user: userSafe });
});

app.post('/api/login', (req, res) => {
    const { role, identifier, password } = req.body;
    if (!role || !identifier || !password) return res.status(400).json({ error: 'Missing fields' });
    
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const table = role === 'doctor' ? db.doctors : db.patients;
    
    const user = table.find(u => u.identifier === identifier && u.password === password);
    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const userSafe = { ...user };
    delete userSafe.password;
    res.json({ success: true, user: userSafe });
});

app.get('/api/doctors', (req, res) => {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const safeDoctors = db.doctors.map(d => ({ id: d.id, name: d.name, identifier: d.identifier, profile: d.profile || {} }));
    res.json(safeDoctors);
});

app.get('/api/patients', (req, res) => {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const safePatients = db.patients.map(p => ({ id: p.id, name: p.name, identifier: p.identifier, profile: p.profile || {} }));
    res.json(safePatients);
});

app.put('/api/profile', (req, res) => {
    const { userId, role, profileData } = req.body;
    if (!userId || !role || !profileData) return res.status(400).json({ error: 'Missing fields' });
    
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const table = role === 'doctor' ? db.doctors : db.patients;
    
    const userIndex = table.findIndex(u => u.id === userId);
    if (userIndex === -1) return res.status(404).json({ error: 'User not found' });
    
    table[userIndex].profile = { ...(table[userIndex].profile || {}), ...profileData };
    fs.writeFileSync(DB_FILE, JSON.stringify(db));
    
    const userSafe = { ...table[userIndex] };
    delete userSafe.password;
    res.json({ success: true, user: userSafe });
});

app.get('/api/appointments', (req, res) => {
    const { userId, role } = req.query;
    if (!userId || !role) return res.json([]);
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const userAppts = db.appointments.filter(a => role === 'doctor' ? a.doctorId === userId : a.patientId === userId);
    
    // Populate names for convenience
    const enriched = userAppts.map(a => {
        const p = db.patients.find(x => x.id === a.patientId);
        const d = db.doctors.find(x => x.id === a.doctorId);
        return { ...a, patientName: p ? p.name : 'Unknown', doctorName: d ? d.name : 'Unknown' };
    });
    
    res.json(enriched);
});

app.post('/api/appointments', async (req, res) => {
    const { patientId, doctorId, time, reason } = req.body;
    if (!patientId || !doctorId || !time) return res.status(400).json({ error: 'Missing fields' });

    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const patient = db.patients.find(p => p.id === patientId);
    const doctor = db.doctors.find(d => d.id === doctorId);
    
    if (!patient || !doctor) return res.status(400).json({ error: 'Invalid users' });

    const appointment = { id: Date.now().toString(), patientId, doctorId, time, reason, status: 'pending' };
    
    if (!db.appointments) db.appointments = [];
    db.appointments.push(appointment);
    fs.writeFileSync(DB_FILE, JSON.stringify(db));

    try {
        const subject = 'Appointment Booked — MediHelp';
        const body = `Hello,\n\nA new consultation has been booked on MediHelp.\n\nPatient: ${patient.name}\nDoctor:  Dr. ${doctor.name}\nDate/Time: ${new Date(time).toLocaleString()}\nReason:  ${reason || 'Not specified'}\n\nStatus: Pending (awaiting doctor approval)\n\nLog in at http://localhost:3000 to manage this appointment.\n\n— MediHelp Medical Portal`;
        await sendEmail(`${patient.identifier},${doctor.identifier}`, subject, body);
    } catch(err) {
        console.error('Email error:', err);
    }

    res.json({ success: true, appointment });
});

app.post('/api/appointments/status', (req, res) => {
    const { appointmentId, status } = req.body;
    if (!appointmentId || !status) return res.status(400).json({ error: 'Missing fields' });
    
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const appt = db.appointments.find(a => a.id === appointmentId);
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });
    
    appt.status = status;
    fs.writeFileSync(DB_FILE, JSON.stringify(db));

    // Send status notification email
    const patient = db.patients.find(p => p.id === appt.patientId);
    const doctor  = db.doctors.find(d => d.id === appt.doctorId);
    if (patient && doctor) {
        const label = status === 'approved' ? 'APPROVED ✓' : 'DECLINED ✕';
        const body = `Hello ${patient.name},\n\nYour appointment request with Dr. ${doctor.name} has been ${label}.\n\nDate/Time: ${new Date(appt.time).toLocaleString()}\nReason: ${appt.reason}\n\nLog in to view your updated appointment status.\n\n— MediHelp Medical Portal`;
        sendEmail(patient.identifier, `Appointment ${label} — MediHelp`, body);
    }

    res.json({ success: true });
});


// ── Tickets (chatbot escalations) ─────────────────────
app.post('/api/tickets', (req, res) => {
    const { patientId, doctorId, summary, chatLog } = req.body;
    if (!patientId || !summary) return res.status(400).json({ error: 'Missing fields' });
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const patient = db.patients.find(p => p.id === patientId);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    const ticket = {
        id: Date.now().toString(),
        patientId, doctorId: doctorId || null,
        patientName: patient.name,
        summary, chatLog: chatLog || [],
        status: 'open',
        createdAt: new Date().toISOString()
    };
    if (!db.tickets) db.tickets = [];
    db.tickets.push(ticket);
    fs.writeFileSync(DB_FILE, JSON.stringify(db));
    // Email the doctor if doctorId provided
    if (doctorId) {
        const doctor = db.doctors.find(d => d.id === doctorId);
        if (doctor) {
            const body = `Hello Dr. ${doctor.name},\n\nA patient (${patient.name}) has raised a health query that needs your attention.\n\nSUMMARY:\n${summary}\n\nPlease log in to MediHelp to review the full ticket.\n\n— MediHelp Health Assistant`;
            sendEmail(doctor.identifier, `Health Query Ticket from ${patient.name} — MediHelp`, body);
        }
    }
    res.json({ success: true, ticket });
});

app.get('/api/tickets', (req, res) => {
    const { doctorId, patientId } = req.query;
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!db.tickets) return res.json([]);
    let tickets = db.tickets;
    if (doctorId) tickets = tickets.filter(t => t.doctorId === doctorId || !t.doctorId);
    if (patientId) tickets = tickets.filter(t => t.patientId === patientId);
    res.json(tickets.reverse()); // newest first
});

app.patch('/api/tickets/:id', (req, res) => {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const ticket = (db.tickets || []).find(t => t.id === req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Not found' });
    if (req.body.status) ticket.status = req.body.status;
    if (req.body.doctorNote) ticket.doctorNote = req.body.doctorNote;
    fs.writeFileSync(DB_FILE, JSON.stringify(db));
    res.json({ success: true });
});

app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
