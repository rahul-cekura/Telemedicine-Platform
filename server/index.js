const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const appointmentRoutes = require('./routes/appointments');
const prescriptionRoutes = require('./routes/prescriptions');
const healthRecordRoutes = require('./routes/healthRecords');
const videoRoutes = require('./routes/video');
const billingRoutes = require('./routes/billing');
const adminRoutes = require('./routes/admin');

const { errorHandler } = require('./middleware/errorHandler');
const { authenticateToken } = require('./middleware/auth');
const { initializeDatabase } = require('./config/database');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') || ["http://localhost:3000"],
    methods: ["GET", "POST"]
  }
});

// Trust proxy - needed for rate limiting behind proxies/load balancers
app.set('trust proxy', 1);

// CORS configuration - MUST be before other middleware to handle preflight requests
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ["http://localhost:3000", "http://localhost:3001"],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "https:"],
    },
  },
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression and logging
app.use(compression());
app.use(morgan('combined'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', authenticateToken, userRoutes);
app.use('/api/appointments', authenticateToken, appointmentRoutes);
app.use('/api/prescriptions', authenticateToken, prescriptionRoutes);
app.use('/api/health-records', authenticateToken, healthRecordRoutes);
app.use('/api/video', authenticateToken, videoRoutes);
app.use('/api/billing', authenticateToken, billingRoutes);
app.use('/api/admin', authenticateToken, adminRoutes);

// Socket.IO for real-time communication
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication error'));
  }
  
  const jwt = require('jsonwebtoken');
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    socket.userRole = decoded.role;
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  console.log(`User ${socket.userId} connected`);
  
  // Join user to their personal room
  socket.join(`user_${socket.userId}`);
  
  // Handle video call events
  socket.on('join-call', (data) => {
    const roomName = `call_${data.appointmentId}`;

    // Get number of clients in the room before joining
    const clientsInRoom = io.sockets.adapter.rooms.get(roomName);
    const numClients = clientsInRoom ? clientsInRoom.size : 0;

    console.log(`User ${socket.userId} joining call ${data.appointmentId}. Room has ${numClients} users.`);

    // Join the room
    socket.join(roomName);

    // Determine if this user is the initiator (first to join)
    const isInitiator = numClients === 0;

    // Send confirmation to the user who joined
    socket.emit('room-joined', {
      isInitiator: isInitiator,
      userId: socket.userId
    });

    // If there's already someone in the room, notify them
    if (numClients > 0) {
      console.log(`Notifying existing user(s) that ${socket.userId} joined`);
      socket.to(roomName).emit('user-joined', {
        userId: socket.userId,
        userRole: socket.userRole
      });
    }
  });

  socket.on('leave-call', (data) => {
    const roomName = `call_${data.appointmentId}`;
    socket.leave(roomName);
    console.log(`User ${socket.userId} left call ${data.appointmentId}`);

    // Notify others in the room
    socket.to(roomName).emit('user-left', {
      userId: socket.userId
    });
  });

  // WebRTC signaling events
  socket.on('call-offer', (data) => {
    const roomName = `call_${data.appointmentId}`;
    console.log(`📤 Forwarding offer from user ${socket.userId} in call ${data.appointmentId}`);
    socket.to(roomName).emit('call-offer', {
      offer: data.offer,
      from: socket.userId
    });
  });

  socket.on('call-answer', (data) => {
    const roomName = `call_${data.appointmentId}`;
    console.log(`📤 Forwarding answer from user ${socket.userId} in call ${data.appointmentId}`);
    socket.to(roomName).emit('call-answer', {
      answer: data.answer,
      from: socket.userId
    });
  });

  socket.on('ice-candidate', (data) => {
    const roomName = `call_${data.appointmentId}`;
    console.log(`📤 Forwarding ICE candidate from user ${socket.userId} in call ${data.appointmentId}`);
    socket.to(roomName).emit('ice-candidate', {
      candidate: data.candidate,
      from: socket.userId
    });
  });
  
  socket.on('disconnect', () => {
    console.log(`User ${socket.userId} disconnected`);
  });
});

// Error handling middleware
app.use(errorHandler);

// Favicon handler
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Initialize database and start server
const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await initializeDatabase();
    console.log('Database initialized successfully');
    
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📱 Environment: ${process.env.NODE_ENV}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

startServer();

module.exports = { app, io };
