const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');

let io;

const SOCKET_EVENTS = {
    NEW_REPORT: 'NEW_REPORT',
    REPORT_UPDATED: 'REPORT_UPDATED',
    JOIN_ROOM: 'joinRoom',
    LEAVE_ROOM: 'leaveRoom'
};

const initializeSocket = (server) => {
    io = socketIO(server, {
        cors: {
            origin: [
                process.env.CLIENT_URL || "http://localhost:3000",
                process.env.MOBILE_URL || "exp+agapayalert-client://192.168.48.191:8081"
            ],
            methods: ["GET", "POST"],
            credentials: true
        }
    });

    // Auth middleware
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token || 
                         socket.handshake.headers.cookie?.split('token=')[1];
            
            if (!token) {
                return next(new Error('Authentication required'));
            }
            
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.user = decoded.user; // Fix: access user from decoded token
            console.log('Socket authenticated:', socket.id, socket.user);
            next();
        } catch (error) {
            console.error('Socket auth error:', error);
            next(new Error('Invalid token'));
        }
    });

    // Connection handler
    io.on('connection', (socket) => {
        // Safe access to user role with optional chaining
        const userRole = socket.user?.roles?.[0];
        console.log(`User connected: ${socket.id}${userRole ? `, Role: ${userRole}` : ''}`);

        // Join role-based room if role exists
        if (userRole) {
            const roleRoom = `role_${userRole}`;
            socket.join(roleRoom);
            console.log(`Joined role room: ${roleRoom}`);
        }

        socket.on('joinRoom', (room) => {
            if (!room) return;
            socket.join(room);
            console.log(`Socket ${socket.id} joined room: ${room}`);
        });

        socket.on('leaveRoom', (room) => {
            if (!room) return;
            socket.leave(room);
            console.log(`Socket ${socket.id} left room: ${room}`);
        });

        socket.on('disconnect', (reason) => {
            console.log(`User disconnected: ${socket.id}, Reason: ${reason}`);
        });
    });

    return io;
};

const getIO = () => {
    if (!io) throw new Error('Socket.io not initialized');
    return io;
};

module.exports = {
    initializeSocket,
    getIO,
    SOCKET_EVENTS
};