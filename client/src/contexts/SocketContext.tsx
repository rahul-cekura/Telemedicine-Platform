import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  joinCall: (callId: string) => void;
  leaveCall: (callId: string) => void;
  sendSignal: (callId: string, signal: any) => void;
  onSignal: (callback: (data: any) => void) => void;
  onUserJoined: (callback: (data: any) => void) => void;
  onUserLeft: (callback: (data: any) => void) => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (context === undefined) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

interface SocketProviderProps {
  children: ReactNode;
}

export const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      const token = localStorage.getItem('token');
      const socketUrl = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';
      console.log('🔌 Connecting to Socket.IO:', socketUrl);

      const newSocket = io(socketUrl, {
        auth: {
          token,
        },
        withCredentials: true, // Required for CORS
        transports: ['websocket', 'polling'], // Try WebSocket first, fallback to polling
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5,
        timeout: 60000, // Match API timeout
      });

      newSocket.on('connect', () => {
        console.log('Connected to server');
        setIsConnected(true);
      });

      newSocket.on('disconnect', () => {
        console.log('Disconnected from server');
        setIsConnected(false);
      });

      newSocket.on('connect_error', (error) => {
        console.error('Socket connection error:', {
          message: error.message,
          description: error.description,
          context: error.context,
          type: error.type
        });
        console.error('Socket URL:', socketUrl);
        console.error('If you see "CORS" or "Network" errors, check:');
        console.error('1. Backend CORS_ORIGIN includes your frontend URL');
        console.error('2. Backend is running and accessible');
        console.error('3. No browser extensions blocking WebSocket connections');
        setIsConnected(false);
      });

      setSocket(newSocket);

      return () => {
        newSocket.close();
        setSocket(null);
        setIsConnected(false);
      };
    }
    return undefined;
  }, [user]);

  const joinCall = (callId: string) => {
    if (socket) {
      socket.emit('join-call', { callId });
    }
  };

  const leaveCall = (callId: string) => {
    if (socket) {
      socket.emit('leave-call', { callId });
    }
  };

  const sendSignal = (callId: string, signal: any) => {
    if (socket) {
      socket.emit('call-signal', { callId, signal });
    }
  };

  const onSignal = (callback: (data: any) => void) => {
    if (socket) {
      socket.on('call-signal', callback);
    }
  };

  const onUserJoined = (callback: (data: any) => void) => {
    if (socket) {
      socket.on('user-joined', callback);
    }
  };

  const onUserLeft = (callback: (data: any) => void) => {
    if (socket) {
      socket.on('user-left', callback);
    }
  };

  const value: SocketContextType = {
    socket,
    isConnected,
    joinCall,
    leaveCall,
    sendSignal,
    onSignal,
    onUserJoined,
    onUserLeft,
  };

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
};
