import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Container,
  Box,
  Paper,
  IconButton,
  Typography,
  Grid,
  Alert,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import {
  Videocam,
  VideocamOff,
  Mic,
  MicOff,
  CallEnd,
  ScreenShare,
  StopScreenShare,
} from '@mui/icons-material';
import { useSocket } from '../../contexts/SocketContext';
import { useAuth } from '../../contexts/AuthContext';

const VideoCall: React.FC = () => {
  const { id: appointmentId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { socket } = useSocket();
  const { user } = useAuth();

  // Refs for video elements and WebRTC
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  // State
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAudioOn, setIsAudioOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string>('');

  // ICE servers for WebRTC (using free STUN servers)
  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };

  // Initialize media devices
  useEffect(() => {
    const initializeMedia = async () => {
      try {
        console.log('🎥 Requesting media devices...');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720 },
          audio: true,
        });

        localStreamRef.current = stream;

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        console.log('✅ Media devices initialized');
        setIsConnecting(false);
      } catch (err: any) {
        console.error('❌ Error accessing media devices:', err);
        setError('Failed to access camera/microphone. Please check permissions.');
        setIsConnecting(false);
      }
    };

    initializeMedia();

    return () => {
      // Cleanup on unmount
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
    };
  }, []);

  // Setup WebRTC connection
  useEffect(() => {
    if (!socket || !localStreamRef.current || !appointmentId) {
      console.log('⏳ Waiting for socket, stream, or appointmentId...');
      return;
    }

    console.log('🚀 Setting up WebRTC connection for appointment:', appointmentId);

    const createPeerConnection = () => {
      console.log('📡 Creating peer connection');
      const pc = new RTCPeerConnection(iceServers);
      peerConnectionRef.current = pc;

      // Add local stream tracks
      localStreamRef.current?.getTracks().forEach(track => {
        console.log('➕ Adding track:', track.kind);
        pc.addTrack(track, localStreamRef.current!);
      });

      // Handle remote stream
      pc.ontrack = (event) => {
        console.log('📥 Received remote track:', event.track.kind);
        if (remoteVideoRef.current && event.streams[0]) {
          remoteVideoRef.current.srcObject = event.streams[0];
          setIsConnected(true);
        }
      };

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('🧊 Sending ICE candidate');
          socket.emit('ice-candidate', {
            candidate: event.candidate,
            appointmentId,
          });
        } else {
          console.log('✅ All ICE candidates sent');
        }
      };

      // Handle connection state
      pc.oniceconnectionstatechange = () => {
        console.log('🔄 ICE connection state:', pc.iceConnectionState);
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          setIsConnected(true);
        } else if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
          setIsConnected(false);
        }
      };

      pc.onconnectionstatechange = () => {
        console.log('🔄 Connection state:', pc.connectionState);
      };

      return pc;
    };

    const pc = createPeerConnection();

    // Handle incoming offer
    socket.on('call-offer', async (data: { offer: RTCSessionDescriptionInit, from: string }) => {
      console.log('📨 Received offer from:', data.from);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        console.log('✅ Set remote description (offer)');

        // Add any pending ICE candidates
        for (const candidate of pendingCandidatesRef.current) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
          console.log('🧊 Added pending ICE candidate');
        }
        pendingCandidatesRef.current = [];

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log('📤 Sending answer');
        socket.emit('call-answer', { answer, appointmentId });
      } catch (err) {
        console.error('❌ Error handling offer:', err);
        setError('Failed to establish connection');
      }
    });

    // Handle incoming answer
    socket.on('call-answer', async (data: { answer: RTCSessionDescriptionInit }) => {
      console.log('📨 Received answer');
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        console.log('✅ Set remote description (answer)');

        // Add any pending ICE candidates
        for (const candidate of pendingCandidatesRef.current) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
          console.log('🧊 Added pending ICE candidate');
        }
        pendingCandidatesRef.current = [];
      } catch (err) {
        console.error('❌ Error handling answer:', err);
      }
    });

    // Handle ICE candidates
    socket.on('ice-candidate', async (data: { candidate: RTCIceCandidateInit }) => {
      console.log('📨 Received ICE candidate');
      try {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          console.log('✅ Added ICE candidate');
        } else {
          console.log('⏳ Queuing ICE candidate (no remote description yet)');
          pendingCandidatesRef.current.push(data.candidate);
        }
      } catch (err) {
        console.error('❌ Error adding ICE candidate:', err);
      }
    });

    // Handle room joined
    socket.on('room-joined', async (data: { isInitiator: boolean, userId: string }) => {
      console.log('🏠 Joined room. Is initiator:', data.isInitiator);
      // Initiator will create offer when they receive user-joined event
    });

    // Handle user joined (we're already in room, create offer)
    socket.on('user-joined', async (data: { userId: string, userRole: string }) => {
      console.log('👤 Other user joined:', data.userId);
      console.log('📤 Creating and sending offer');
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('call-offer', { offer, appointmentId });
        console.log('✅ Offer sent');
      } catch (err) {
        console.error('❌ Error creating offer:', err);
      }
    });

    // Handle user left
    socket.on('user-left', () => {
      console.log('👋 Other user left');
      setIsConnected(false);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
    });

    // Join the call
    console.log('📞 Joining call:', appointmentId);
    socket.emit('join-call', { appointmentId, userId: user?.id });

    return () => {
      console.log('🧹 Cleaning up socket listeners');
      socket.off('call-offer');
      socket.off('call-answer');
      socket.off('ice-candidate');
      socket.off('room-joined');
      socket.off('user-joined');
      socket.off('user-left');
    };
  }, [socket, appointmentId, user, iceServers]);

  // Toggle video
  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOn(videoTrack.enabled);
      }
    }
  };

  // Toggle audio
  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioOn(audioTrack.enabled);
      }
    }
  };

  // Toggle screen sharing
  const toggleScreenShare = async () => {
    if (!peerConnectionRef.current) return;

    try {
      if (!isScreenSharing) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
        });

        const videoTrack = screenStream.getVideoTracks()[0];
        const sender = peerConnectionRef.current
          .getSenders()
          .find(s => s.track?.kind === 'video');

        if (sender) {
          sender.replaceTrack(videoTrack);
        }

        videoTrack.onended = () => {
          const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
          if (cameraTrack && sender) {
            sender.replaceTrack(cameraTrack);
          }
          setIsScreenSharing(false);
        };

        setIsScreenSharing(true);
      } else {
        const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
        const sender = peerConnectionRef.current
          .getSenders()
          .find(s => s.track?.kind === 'video');

        if (cameraTrack && sender) {
          sender.replaceTrack(cameraTrack);
        }
        setIsScreenSharing(false);
      }
    } catch (err) {
      console.error('Error toggling screen share:', err);
      setError('Failed to share screen');
    }
  };

  // End call
  const endCall = () => {
    if (socket && appointmentId) {
      socket.emit('leave-call', { appointmentId });
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }

    navigate('/appointments');
  };

  if (isConnecting) {
    return (
      <Container maxWidth="lg" sx={{ mt: 4, textAlign: 'center' }}>
        <CircularProgress />
        <Typography variant="h6" sx={{ mt: 2 }}>
          Setting up your camera and microphone...
        </Typography>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ mt: 2, mb: 2 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {!isConnected && !error && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Waiting for the other participant to join...
        </Alert>
      )}

      <Grid container spacing={2}>
        {/* Remote video (main view) */}
        <Grid item xs={12} md={9}>
          <Paper sx={{ position: 'relative', bgcolor: '#000', aspectRatio: '16/9' }}>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                display: isConnected ? 'block' : 'none',
              }}
            />
            {!isConnected && (
              <Box
                sx={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  textAlign: 'center',
                  color: 'white',
                }}
              >
                <CircularProgress color="inherit" sx={{ mb: 2 }} />
                <Typography variant="h5">Connecting...</Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  Check the browser console for connection details
                </Typography>
              </Box>
            )}
          </Paper>
        </Grid>

        {/* Local video (small preview) */}
        <Grid item xs={12} md={3}>
          <Paper sx={{ position: 'relative', bgcolor: '#000', aspectRatio: '4/3' }}>
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: 'scaleX(-1)',
              }}
            />
            <Typography
              variant="caption"
              sx={{
                position: 'absolute',
                bottom: 8,
                left: 8,
                color: 'white',
                bgcolor: 'rgba(0,0,0,0.6)',
                px: 1,
                py: 0.5,
                borderRadius: 1,
              }}
            >
              You
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      {/* Controls */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          gap: 2,
          mt: 3,
        }}
      >
        <Tooltip title={isVideoOn ? 'Turn off camera' : 'Turn on camera'}>
          <IconButton
            onClick={toggleVideo}
            sx={{
              bgcolor: isVideoOn ? 'primary.main' : 'error.main',
              color: 'white',
              '&:hover': {
                bgcolor: isVideoOn ? 'primary.dark' : 'error.dark',
              },
            }}
          >
            {isVideoOn ? <Videocam /> : <VideocamOff />}
          </IconButton>
        </Tooltip>

        <Tooltip title={isAudioOn ? 'Mute microphone' : 'Unmute microphone'}>
          <IconButton
            onClick={toggleAudio}
            sx={{
              bgcolor: isAudioOn ? 'primary.main' : 'error.main',
              color: 'white',
              '&:hover': {
                bgcolor: isAudioOn ? 'primary.dark' : 'error.dark',
              },
            }}
          >
            {isAudioOn ? <Mic /> : <MicOff />}
          </IconButton>
        </Tooltip>

        <Tooltip title={isScreenSharing ? 'Stop sharing' : 'Share screen'}>
          <IconButton
            onClick={toggleScreenShare}
            sx={{
              bgcolor: isScreenSharing ? 'success.main' : 'primary.main',
              color: 'white',
              '&:hover': {
                bgcolor: isScreenSharing ? 'success.dark' : 'primary.dark',
              },
            }}
          >
            {isScreenSharing ? <StopScreenShare /> : <ScreenShare />}
          </IconButton>
        </Tooltip>

        <Tooltip title="End call">
          <IconButton
            onClick={endCall}
            sx={{
              bgcolor: 'error.main',
              color: 'white',
              '&:hover': {
                bgcolor: 'error.dark',
              },
            }}
          >
            <CallEnd />
          </IconButton>
        </Tooltip>
      </Box>
    </Container>
  );
};

export default VideoCall;
