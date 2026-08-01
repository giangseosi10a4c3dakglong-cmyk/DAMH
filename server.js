const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const nodemailer = require('nodemailer');

const app = express();
// Sửa lại đoạn này để Render tự động cấp cổng mạng, nếu không có thì dùng cổng 3000
const PORT = process.env.PORT || 3000;

// Cấu hình CORS đầy đủ để nhận request từ GitHub Pages lên Render
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// ==========================================
// 1. CẤU HÌNH DATABASE
// ==========================================
const pool = mysql.createPool({
    host: 'sakura.proxy.rlwy.net',
    port: 40740,
    user: 'root',
    password: 'RwuJsOoxqUvdtUiwnykqAidCFjmoZPnI',
    database: 'railway',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

pool.getConnection((err, connection) => {
    if (err) return console.error('❌ Lỗi kết nối MySQL:', err.message);
    console.log('✅ Đã kết nối MySQL! Đang kiểm tra cấu trúc bảng...');
    
    connection.query(`CREATE TABLE IF NOT EXISTS Users (UserID INT AUTO_INCREMENT PRIMARY KEY, FullName VARCHAR(255) NOT NULL, Email VARCHAR(255) NOT NULL UNIQUE, Username VARCHAR(100) NOT NULL UNIQUE, Password VARCHAR(255) NOT NULL, Role VARCHAR(20) DEFAULT 'Employee', OTP VARCHAR(6) NULL, IsActive BOOLEAN DEFAULT FALSE)`);
    connection.query(`CREATE TABLE IF NOT EXISTS MeetingRooms (RoomID INT AUTO_INCREMENT PRIMARY KEY, RoomName VARCHAR(100) NOT NULL UNIQUE)`);
    connection.query(`CREATE TABLE IF NOT EXISTS Meetings (MeetingID INT AUTO_INCREMENT PRIMARY KEY, Title VARCHAR(255) NOT NULL, Creator VARCHAR(255) NOT NULL, StartTime DATETIME NOT NULL, EndTime DATETIME NOT NULL, Room VARCHAR(100) NOT NULL, Participants TEXT, Content TEXT, Status VARCHAR(50) DEFAULT 'Chờ xác nhận')`);
    
    // Khởi tạo Admin và 3 phòng mặc định
    connection.query(`INSERT IGNORE INTO Users (FullName, Email, Username, Password, Role, IsActive) VALUES ('Quản Trị Viên', 'admin@congty.com', 'admin', '12345678', 'Admin', TRUE)`);
    connection.query(`INSERT IGNORE INTO MeetingRooms (RoomName) VALUES ('Phòng VIP 1 (Tầng 1)'), ('Phòng Họp Lớn (Tầng 2)'), ('Phòng Thảo Luận (Tầng 3)')`);
    
    connection.release();
});

// ==========================================
// 2. CẤU HÌNH NODEMAILER
// ==========================================
const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    family: 4, // ép dùng IPv4
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// ==========================================
// 3. API TÀI KHOẢN (ĐĂNG KÝ, ĐĂNG NHẬP, QUÊN MK)
// ==========================================
app.post('/api/register', (req, res) => {
    const { fullname, email, username, password } = req.body;
const otp = Math.floor(100000 + Math.random() * 900000).toString(); 

    pool.query(`INSERT INTO Users (FullName, Email, Username, Password, OTP, IsActive) VALUES (?, ?, ?, ?, ?, FALSE)`, [fullname, email, username, password, otp], (err) => {
        if (err) return res.status(400).send("Tên đăng nhập hoặc Email đã tồn tại!");
        transporter.sendMail({
            from: '"Hệ Thống Lịch Họp" <giangseosi.10a4.c3dakglong@gmail.com>',
            to: email, subject: 'Mã Xác Thực Tài Khoản',
            html: `<h3>Xin chào ${fullname}</h3><p>Mã OTP kích hoạt tài khoản của bạn là: <b style="color:red; font-size: 20px;">${otp}</b></p>`
        });
        res.status(200).send("Đăng ký thành công! Đang gửi OTP...");
    });
});

app.post('/api/register/verify', (req, res) => {
    const { email, otp } = req.body;
    pool.query(`SELECT * FROM Users WHERE Email = ? AND OTP = ?`, [email, otp], (err, results) => {
        if (results.length === 0) return res.status(400).send("Mã OTP không đúng!");
        pool.query(`UPDATE Users SET IsActive = TRUE, OTP = NULL WHERE Email = ?`, [email]);
        res.status(200).send("Kích hoạt tài khoản thành công!");
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    pool.query(`SELECT * FROM Users WHERE (Username = ? OR Email = ?) AND Password = ?`, [username, username, password], (err, results) => {
        if (err || results.length === 0) return res.status(400).send("Tài khoản/Mật khẩu sai!");
        if (!results[0].IsActive) return res.status(403).send("Tài khoản chưa được kích hoạt OTP!");
        res.status(200).json({ user: results[0] });
    });
});

app.post('/api/sso-login', (req, res) => {
    const { email, fullname, provider } = req.body;
    pool.query(`SELECT * FROM Users WHERE Email = ?`, [email], (err, results) => {
        if (err) return res.status(500).send("Lỗi máy chủ cơ sở dữ liệu!");
        if (results.length > 0) {
            if (!results[0].IsActive) {
                pool.query(`UPDATE Users SET IsActive = TRUE WHERE Email = ?`, [email]);
                results[0].IsActive = 1;
            }
            return res.status(200).json({ user: results[0] });
        } else {
            const username = email.split('@')[0] + Math.floor(Math.random() * 10000);
            const randomPass = Math.random().toString(36).slice(-8); 
            pool.query(`INSERT INTO Users (FullName, Email, Username, Password, Role, IsActive) VALUES (?, ?, ?, ?, 'Employee', TRUE)`, [fullname, email, username, randomPass], (err, insertResult) => {
                if (err) return res.status(500).send("Lỗi khi khởi tạo tài khoản SSO.");
                pool.query(`SELECT * FROM Users WHERE UserID = ?`, [insertResult.insertId], (e, newUser) => res.status(200).json({ user: newUser[0] }));
            });
        }
    });
});

app.post('/api/users/forgot-password', (req, res) => {
const { email } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    pool.query(`UPDATE Users SET OTP = ? WHERE Email = ?`, [otp, email], (err, result) => {
        if (result.affectedRows === 0) return res.status(404).send("Email không tồn tại!");
        transporter.sendMail({
            from: '"Hệ Thống" <giangseosi.10a4.c3dakglong@gmail.com>',
            to: email, subject: 'Quên Mật Khẩu - Mã OTP',
            html: `<p>Mã OTP đổi mật khẩu của bạn là: <b style="color:red; font-size: 20px;">${otp}</b></p>`
        });
        res.status(200).send("OTP đã gửi.");
    });
});

app.post('/api/users/reset-password', (req, res) => {
    const { email, otp, newPassword } = req.body;
    pool.query(`SELECT * FROM Users WHERE Email = ? AND OTP = ?`, [email, otp], (err, results) => {
        if (results.length === 0) return res.status(400).send("OTP sai!");
        pool.query(`UPDATE Users SET Password = ?, OTP = NULL WHERE Email = ?`, [newPassword, email]);
        res.status(200).send("Đổi mật khẩu thành công!");
    });
});

app.put('/api/users/profile', (req, res) => {
    pool.query(`UPDATE Users SET FullName=?, Email=? WHERE Username=?`, [req.body.newFullName, req.body.newEmail, req.body.username], (err) => {
        if(err) return res.status(400).send("Email đã tồn tại.");
        res.status(200).send("Thành công");
    });
});

app.put('/api/users/change-password', (req, res) => {
    pool.query(`SELECT * FROM Users WHERE Username=? AND Password=?`, [req.body.username, req.body.oldPassword], (err, r) => {
        if(r.length===0) return res.status(400).send("Pass cũ sai.");
        pool.query(`UPDATE Users SET Password=? WHERE Username=?`, [req.body.newPassword, req.body.username]);
        res.status(200).send("Thành công");
    });
});

// ==========================================
// 4. API LỊCH HỌP & PHÒNG HỌP
// ==========================================
app.get('/api/rooms/available', (req, res) => {
    const { start, end } = req.query;
    if (!start || !end) return pool.query(`SELECT RoomName FROM MeetingRooms`, (e, r) => res.json(r));

    const s = start.replace('T', ' '), e = end.replace('T', ' ');
    pool.query(`SELECT DISTINCT Room FROM Meetings WHERE Status != 'Từ chối' AND StartTime < ? AND EndTime > ?`, [e, s], (err, busy) => {
        const busyRooms = busy.map(b => b.Room);
        pool.query(`SELECT RoomName FROM MeetingRooms`, (err, all) => {
            res.json(all.map(r => ({ RoomName: r.RoomName, isAvailable: !busyRooms.includes(r.RoomName) })));
        });
    });
});

app.post('/api/rooms', (req, res) => {
    if (req.body.role !== 'Admin') return res.status(403).send("Chỉ Admin mới có quyền!");
    pool.query(`INSERT INTO MeetingRooms (RoomName) VALUES (?)`, [req.body.roomName], (err) => {
        if (err) return res.status(400).send("Phòng đã tồn tại!");
        res.status(200).send("Thêm thành công!");
    });
});

app.post('/api/meetings', (req, res) => {
    const { title, creator, startTime, endTime, room, participants, content } = req.body;
    const s = startTime.replace('T', ' '), e = endTime.replace('T', ' ');

    pool.query(`SELECT * FROM Meetings WHERE Room = ? AND Status != 'Từ chối' AND StartTime < ? AND EndTime > ?`, [room, e, s], (err, roomConf) => {
        if (roomConf.length > 0) return res.status(400).json({ error: "Phòng đã bị trùng lịch!" });
        pool.query(`SELECT * FROM Meetings WHERE (Creator = ? OR Participants LIKE ?) AND Status != 'Từ chối' AND StartTime < ? AND EndTime > ?`, [creator, `%${participants}%`, e, s], (err, userConf) => {
            if (userConf.length > 0) return res.status(400).json({ error: "Người tạo/tham gia đã vướng lịch khác!" });
            pool.query(`INSERT INTO Meetings (Title, Creator, StartTime, EndTime, Room, Participants, Content) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
            [title, creator, s, e, room, participants, content], () => res.status(200).json({ message: "Đặt thành công!" }));
        });
    });
});

app.put('/api/meetings/:id', (req, res) => {
    const { title, startTime, endTime, room, participants, content } = req.body;
    pool.query(`UPDATE Meetings SET Title=?, StartTime=?, EndTime=?, Room=?, Participants=?, Content=? WHERE MeetingID=?`, 
    [title, startTime.replace('T', ' '), endTime.replace('T', ' '), room, participants, content, req.params.id], () => res.send("Thành công"));
});

app.get('/api/meetings', (req, res) => {
    pool.query(`SELECT MeetingID, Title, Creator, DATE_FORMAT(StartTime, '%Y-%m-%dT%H:%i') AS StartTime, DATE_FORMAT(EndTime, '%Y-%m-%dT%H:%i') AS EndTime, Room, Participants, Content, Status FROM Meetings ORDER BY StartTime DESC`, (e, r) => res.json(r));
});

app.put('/api/meetings/:id/status', (req, res) => {
    pool.query(`UPDATE Meetings SET Status=? WHERE MeetingID=?`, [req.body.status, req.params.id], () => res.send("OK"));
});

app.delete('/api/meetings/:id', (req, res) => {
    pool.query(`DELETE FROM Meetings WHERE MeetingID=?`, [req.params.id], () => res.send("OK"));
});

// ==========================================
// 5. API ADMIN (THỐNG KÊ & QUẢN LÝ USER)
// ==========================================
app.get('/api/stats', (req, res) => {
    const days = req.query.range === 'month' ? 30 : 7;
    pool.query(`SELECT Room, COUNT(*) AS Total, SUM(TIMESTAMPDIFF(MINUTE, StartTime, EndTime))/60 AS Hours FROM Meetings WHERE Status != 'Từ chối' AND StartTime >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY Room ORDER BY Hours DESC`, [days], (e, r) => res.json(r));
});

app.get('/api/users', (req, res) => {
    pool.query(`SELECT UserID, FullName, Email, Username, Role, IsActive FROM Users ORDER BY Role ASC, FullName ASC`, (err, results) => res.json(results));
});

app.put('/api/users/:id/toggle-lock', (req, res) => {
pool.query(`UPDATE Users SET IsActive = NOT IsActive WHERE UserID = ?`, [req.params.id], () => res.send("OK"));
});

app.listen(PORT, () => console.log(`🚀 Server chạy tại cổng ${PORT}`));
