const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');

let io;

const SOCKET_EVENTS = {
    NEW_REPORT: 'newReport',
    UPDATE_REPORT: 'updateReport',
    NEW_NOTIFICATION: 'newNotification',
    LOCATION_UPDATE: 'locationUpdate',
    STATUS_CHANGE: 'statusChange',
    FEEDBACK_CREATED: 'feedbackCreated',
    FEEDBACK_UPDATED: 'feedbackUpdated'
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

    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token;
            if (!token) {
                return next(new Error('Authentication required'));
            }
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.user = decoded;
            next();
        } catch (error) {
            next(new Error('Invalid token'));
        }
    });

    io.on('connection', (socket) => {
        console.log(`User connected: ${socket.id}`);
        
        socket.join(`user_${socket.user.id}`);
        
        if (socket.user.roles) {
            socket.user.roles.forEach(role => {
                socket.join(`role_${role}`);
            });
        }

        socket.on('disconnect', () => {
            console.log(`User disconnected: ${socket.id}`);
        });
    });

    return io;
};

const getIO = () => {
    if (!io) throw new Error('Socket.io not initialized');
    return io;
};

const emitToUser = (userId, event, data) => {
    if (!io) throw new Error('Socket.io not initialized');
    io.to(`user_${userId}`).emit(event, data);
};

const emitToRole = (role, event, data) => {
    if (!io) throw new Error('Socket.io not initialized');
    io.to(`role_${role}`).emit(event, data);
};

const emitToAll = (event, data) => {
    if (!io) throw new Error('Socket.io not initialized');
    io.emit(event, data);
};

module.exports = {
    initializeSocket,
    getIO,
    emitToUser,
    emitToRole,
    emitToAll,
    SOCKET_EVENTS
};