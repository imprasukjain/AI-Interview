import { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Video, VideoOff, Bot, Play } from 'lucide-react';
import { io } from 'socket.io-client';
import RecordRTC from 'recordrtc';

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const [timeLeft, setTimeLeft] = useState(300); // 300 seconds = 5 minutes
  const [interviewStarted, setInterviewStarted] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<RecordRTC | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<any>(null);
  const speechSynthesisRef = useRef<SpeechSynthesisUtterance | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Initialize socket connection
    socketRef.current = io('http://localhost:3000', {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current.on('bot-response', (message: string) => {
      setMessages(prev => [...prev, message]);
      speakMessage(message);  // 🔹 This will now handle speech synthesis in frontend
    });

    return () => {
      socketRef.current?.disconnect();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isRecording && timeLeft > 0) {
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            stopInterview();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isRecording]);

  const speakMessage = (text: string) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);

      // 🔹 Ensure bot waits before sending next message
      utterance.onend = () => {
        console.log("Bot finished speaking.");
      };

      window.speechSynthesis.speak(utterance);
    }
  };

  const startInterview = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      mediaRecorderRef.current = new RecordRTC(stream, {
        type: 'video',
        mimeType: 'video/webm',
        recorderType: RecordRTC.MediaStreamRecorder
      });

      mediaRecorderRef.current.startRecording();
      setIsRecording(true);
      setIsCameraOn(true);
      setInterviewStarted(true);

      // Notify backend to start the interview
      socketRef.current?.emit('start-interview');

      // Start sending audio stream to backend
      const audioContext = new AudioContext();
      const audioSource = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(1024, 1, 1);

      processor.onaudioprocess = (e) => {
        const audioData = e.inputBuffer.getChannelData(0);

        // 🔹 Convert Float32Array to Int16Array (WAV compatible)
        const int16Array = new Int16Array(audioData.length);
        for (let i = 0; i < audioData.length; i++) {
          int16Array[i] = audioData[i] * 32767; // Convert float to PCM Int16
        }

        // 🔹 Create a Blob with correct MIME type
        const audioBlob = new Blob([int16Array], { type: 'audio/wav' });

        socketRef.current?.emit('audio-stream', audioBlob);
      };

      audioSource.connect(processor);
      processor.connect(audioContext.destination);
    } catch (error) {
      console.error('Error accessing media devices:', error);
    }
  };

  const stopInterview = async () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stopRecording(() => {
        const blob = mediaRecorderRef.current?.getBlob();
        if (blob) {
          // Send the final recording to the backend
          const formData = new FormData();
          formData.append('video', blob, 'interview.webm');

          fetch('http://localhost:3000/save-recording', {
            method: 'POST',
            body: formData
          })
              .then(response => response.json())
              .then(data => {
                console.log('Recording saved:', data);
              })
              .catch(error => {
                console.error('Error saving recording:', error);
              });
        }
      });
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    setIsRecording(false);
    setIsCameraOn(false);
    setInterviewStarted(false);
    setTimeLeft(300);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white">
        <header className="bg-black/30 p-4">
          <div className="container mx-auto flex items-center justify-between">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Bot className="w-8 h-8" />
              Xcelyst AI Interview (Testing Version)
            </h1>
            <div className="text-xl font-mono">
              {formatTime(timeLeft)}
            </div>
          </div>
        </header>

        <main className="container mx-auto p-4 mt-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2">
              <div className="bg-black/20 rounded-lg p-4">
                <div className="aspect-video bg-black/40 rounded-lg overflow-hidden relative">
                  <video
                      ref={videoRef}
                      autoPlay
                      muted
                      playsInline
                      className="w-full h-full object-cover"
                  />
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-4">
                    {!interviewStarted ? (
                        <button
                            onClick={startInterview}
                            className="rounded-full p-4 bg-green-500 hover:bg-green-600 flex items-center gap-2"
                        >
                          <Play className="w-6 h-6" />
                          <span>Start Interview</span>
                        </button>
                    ) : (
                        <>
                          <button
                              onClick={stopInterview}
                              className="rounded-full p-4 bg-red-500 hover:bg-red-600"
                          >
                            <MicOff />
                          </button>
                          <button
                              onClick={() => setIsCameraOn(!isCameraOn)}
                              className="rounded-full p-4 bg-blue-500 hover:bg-blue-600"
                          >
                            {isCameraOn ? <Video /> : <VideoOff />}
                          </button>
                        </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-black/20 rounded-lg p-4">
              <h2 className="text-xl font-semibold mb-4">AI Assistant Responses</h2>
              <div className="h-[600px] overflow-y-auto">
                {messages.map((message, index) => (
                    <div key={index} className="bg-black/30 rounded p-3 mb-2">
                      <p>{message}</p>
                    </div>
                ))}
                {messages.length === 0 && (
                    <div className="text-center text-gray-400 mt-8">
                      <Bot className="w-12 h-12 mx-auto mb-2" />
                      <p>Start the interview to see AI responses</p>
                    </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
  );
}

export default App;