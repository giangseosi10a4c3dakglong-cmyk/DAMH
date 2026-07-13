const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// =======================================================
// CẤU HÌNH KẾT NỐI DATABASE (MySQL)
// =======================================================

const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'chijyangtc', 
    database: 'MeetingSystemDB',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Kiểm tra kết nối và TỰ ĐỘNG TẠO BẢNG (nếu chưa có) để hệ thống chạy được ngay
pool.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Lỗi kết nối MySQL. Vui lòng kiểm tra lại mật khẩu hoặc đảm bảo Database "MeetingSystemDB" đã được tạo thủ công trong MySQLWorkbench:', err.message);
    } else {
        console.log('✅ Đã kết nối thành công tới database MySQL (MeetingSystemDB)!');
        
        // Tạo bảng Users
        connection.query(`
            CREATE TABLE IF NOT EXISTS Users (
                UserID INT AUTO_INCREMENT PRIMARY KEY,
                FullName VARCHAR(255) NOT NULL,
                Email VARCHAR(255) NOT NULL UNIQUE,
                Username VARCHAR(100) NOT NULL UNIQUE,
                Password VARCHAR(255) NOT NULL
            )
        `);

        // Tạo bảng MeetingRooms
        connection.query(`
            CREATE TABLE IF NOT EXISTS MeetingRooms (
                RoomID INT AUTO_INCREMENT PRIMARY KEY,
                RoomName VARCHAR(100) NOT NULL UNIQUE
            )
        `);

        // Tạo bảng Meetings
        connection.query(`
            CREATE TABLE IF NOT EXISTS Meetings (
                MeetingID INT AUTO_INCREMENT PRIMARY KEY,
                Title VARCHAR(255) NOT NULL,
                Creator VARCHAR(255) NOT NULL,
                StartTime DATETIME NOT NULL,
                EndTime DATETIME NOT NULL,
                Room VARCHAR(100) NOT NULL,
                Status VARCHAR(50) DEFAULT 'Chờ xác nhận'
            )
        `);

        console.log('✅ Đã kiểm tra và khởi tạo cấu trúc các bảng thành công!');
        connection.release();
    }
});


// =======================================================
// HỆ THỐNG API ĐỒNG BỘ VỚI FRONT-END
// =======================================================

// 1. API ĐĂNG KÝ TÀI KHOẢN (register.html)
app.post('/api/register', (req, res) => {
    const { fullname, email, username, password } = req.body;
    
    if (!fullname || !email || !username || !password) {
        return res.status(400).send("Vui lòng điền đầy đủ thông tin!");
    }

    const sql = `INSERT INTO Users (FullName, Email, Username, Password) VALUES (?, ?, ?, ?)`;
    pool.query(sql, [fullname, email, username, password], (err, results) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).send("Tên đăng nhập hoặc Email đã tồn tại trong hệ thống!");
            }
            return res.status(500).send("Lỗi hệ thống khi đăng ký.");
        }
        res.status(200).send("Đăng ký tài khoản thành công!");
    });
});

// 2. API ĐĂNG NHẬP (login.html)
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    const sql = `SELECT * FROM Users WHERE (Username = ? OR Email = ?) AND Password = ?`;
    // Cho phép đăng nhập bằng cả Email hoặc Username
    pool.query(sql, [username, username, password], (err, results) => {
        if (err) return res.status(500).send("Lỗi server.");
        
        if (results.length === 0) {
            return res.status(400).send("Tên đăng nhập hoặc mật khẩu không đúng!");
        }

        const userRow = results[0];
        res.status(200).json({
            user: {
                FullName: userRow.FullName,
                Email: userRow.Email,
                Username: userRow.Username
            }
        });
    });
});

// 3. API LẤY DANH SÁCH PHÒNG HỌP (create-meeting.html)
app.get('/api/rooms', (req, res) => {
    const sql = `SELECT RoomName FROM MeetingRooms`;
    pool.query(sql, (err, results) => {
        if (err) return res.status(500).json([]);
        res.status(200).json(results);
    });
});

// 4. BỔ SUNG: API THÊM PHÒNG HỌP MỚI (create-meeting.html)
app.post('/api/rooms', (req, res) => {
    const { roomName } = req.body;

    if (!roomName) {
        return res.status(400).send("Tên phòng không được để trống!");
    }

    const sql = `INSERT INTO MeetingRooms (RoomName) VALUES (?)`;
    pool.query(sql, [roomName], (err, results) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).send("Phòng họp này đã tồn tại!");
            }
            return res.status(500).send("Lỗi khi thêm phòng họp.");
        }
        res.status(200).send("Thêm phòng thành công!");
    });
});

// 5. API LẤY DANH SÁCH CUỘC HỌP (dashboard.html)
app.get('/api/meetings', (req, res) => {
    const sql = `SELECT MeetingID, Title, Creator, 
                        DATE_FORMAT(StartTime, '%Y-%m-%d %H:%i:%s') AS StartTime, 
                        DATE_FORMAT(EndTime, '%Y-%m-%d %H:%i:%s') AS EndTime, 
                        Room, Status FROM Meetings
                 ORDER BY StartTime DESC`;
    pool.query(sql, (err, results) => {
        if (err) return res.status(500).json([]);
        res.status(200).json(results);
    });
});

// 6. API ĐẶT LỊCH HỌP MỚI + KIỂM TRA TRÙNG LỊCH (create-meeting.html)
app.post('/api/meetings', (req, res) => {
    const { title, creator, startTime, endTime, room } = req.body;

    const formattedStart = startTime.replace('T', ' ');
    const formattedEnd = endTime.replace('T', ' ');

    const checkConflictSql = `
        SELECT * FROM Meetings 
        WHERE Room = ? 
          AND Status != 'Từ chối'
          AND StartTime < ? 
          AND EndTime > ?
    `;

    pool.query(checkConflictSql, [room, formattedEnd, formattedStart], (err, results) => {
        if (err) {
            return res.status(500).json({ error: "Lỗi kiểm tra trùng lịch trên hệ thống." });
        }
        
        if (results.length > 0) {
            return res.status(400).json({ error: "Phòng họp đã bị trùng lịch với cuộc họp khác trong khung giờ này!" });
        }

        const insertSql = `INSERT INTO Meetings (Title, Creator, StartTime, EndTime, Room, Status) VALUES (?, ?, ?, ?, ?, 'Chờ xác nhận')`;
        pool.query(insertSql, [title, creator, formattedStart, formattedEnd, room], (err, insertResults) => {
            if (err) {
                return res.status(500).json({ error: "Không thể lưu thông tin lịch họp vào database." });
            }
            res.status(200).json({ message: "Đặt lịch thành công!", id: insertResults.insertId });
        });
    });
});

// 7. API HỦY LỊCH HỌP (dashboard.html)
app.delete('/api/meetings/:id', (req, res) => {
    const meetingId = req.params.id;
    const sql = `DELETE FROM Meetings WHERE MeetingID = ?`;
    
    pool.query(sql, [meetingId], (err, results) => {
        if (err) return res.status(500).send("Lỗi hệ thống khi hủy lịch.");
        res.status(200).send("Đã xóa cuộc họp thành công!");
    });
});

// 8. API DUYỆT / TỪ CHỐI LỊCH HỌP (dashboard.html)
app.put('/api/meetings/:id/status', (req, res) => {
    const meetingId = req.params.id;
    const { status } = req.body; // 'Đồng ý' hoặc 'Từ chối'

    const sql = `UPDATE Meetings SET Status = ? WHERE MeetingID = ?`;
    pool.query(sql, [status, meetingId], (err, results) => {
        if (err) return res.status(500).send("Lỗi hệ thống khi cập nhật trạng thái.");
        res.status(200).send("Cập nhật trạng thái cuộc họp thành công!");
    });
});

// =======================================================
// BỔ SUNG API QUẢN LÝ TÀI KHOẢN
// =======================================================

// 9. API QUÊN MẬT KHẨU (Reset Password)
app.post('/api/users/forgot-password', (req, res) => {
    const { usernameOrEmail } = req.body;
    
    // Tạo mật khẩu ngẫu nhiên 8 ký tự (chữ + số)
    const newPassword = Math.random().toString(36).slice(-8);

    const sql = `UPDATE Users SET Password = ? WHERE Username = ? OR Email = ?`;
    pool.query(sql, [newPassword, usernameOrEmail, usernameOrEmail], (err, results) => {
        if (err) return res.status(500).send("Lỗi hệ thống.");
        
        if (results.affectedRows === 0) {
            return res.status(404).send("Không tìm thấy tài khoản với Username hoặc Email này!");
        }
        
        // CẢNH BÁO: Thực tế phải gửi qua Email, ở đây trả về trực tiếp để test demo
        res.status(200).json({ message: `Mật khẩu mới của bạn là: ${newPassword}\nVui lòng đăng nhập lại và đổi mật khẩu ngay!` });
    });
});

// 10. API CẬP NHẬT THÔNG TIN CÁ NHÂN
app.put('/api/users/profile', (req, res) => {
    const { username, newFullName, newEmail } = req.body;
    const sql = `UPDATE Users SET FullName = ?, Email = ? WHERE Username = ?`;
    
    pool.query(sql, [newFullName, newEmail, username], (err, results) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') return res.status(400).send("Email này đã được sử dụng bởi người khác!");
            return res.status(500).send("Lỗi hệ thống khi cập nhật.");
        }
        res.status(200).send("Cập nhật thông tin thành công!");
    });
});

// 11. API ĐỔI MẬT KHẨU
app.put('/api/users/change-password', (req, res) => {
    const { username, oldPassword, newPassword } = req.body;
    
    // Kiểm tra mật khẩu cũ trước
    const checkSql = `SELECT * FROM Users WHERE Username = ? AND Password = ?`;
    pool.query(checkSql, [username, oldPassword], (err, results) => {
        if (err) return res.status(500).send("Lỗi hệ thống.");
        if (results.length === 0) return res.status(400).send("Mật khẩu cũ không chính xác!");

        // Cập nhật mật khẩu mới
        const updateSql = `UPDATE Users SET Password = ? WHERE Username = ?`;
        pool.query(updateSql, [newPassword, username], (err, updateResults) => {
            if (err) return res.status(500).send("Lỗi khi đổi mật khẩu.");
            res.status(200).send("Đổi mật khẩu thành công!");
        });
    });
});

// Khởi động server
app.listen(PORT, () => {
    console.log(`🚀 Server Backend đang chạy ổn định tại: http://localhost:${PORT}`);
});