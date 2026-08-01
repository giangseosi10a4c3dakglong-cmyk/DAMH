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
