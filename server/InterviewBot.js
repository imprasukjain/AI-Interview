import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';
import fs from 'fs';
import wav from 'wav';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class InterviewBot {
  constructor(role, questions, socket, interviewDuration = 300) {
    this.role = role;
    this.questions = questions;
    this.socket = socket;
    this.askedQuestions = [];
    this.dontKnowTopics = [];
    this.audioBuffer = [];
    this.interviewDuration = interviewDuration;
    this.isProcessingAudio = false;
    this.is
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  async speak(text) {
    return new Promise((resolve) => {
      this.socket.emit('bot-response', text); // Send text to frontend
      resolve();
    });
  }

  userDoesntKnow(transcript) {
    if (!transcript || typeof transcript !== 'string') {
      console.warn("Received invalid transcript:", transcript);
      return false;
    }

    const dontKnowPhrases = [
      "don't know", "i am not sure", "i am unsure", "i have no idea", "do not know",
      "sorry, i don't know", "can't recall", "don't remember", "I am sorry", "I'm sorry",
      "i am not familiar", "not sure", "no idea"
    ];

    return dontKnowPhrases.some(phrase => transcript.toLowerCase().includes(phrase));
  }

  async generateFollowUp(userResponse) {
    const prompt = `Context: You are conducting an interview for a ${this.role} role.\n`
        + `Focus on evaluating the candidate's technical depth with skill-specific, tricky, and to-the-point questions.\n`
        + `Do not repeat already asked questions or topics the user doesn't know: ${this.dontKnowTopics.join(", ")}.\n`
        + `User has been asked questions like: ${this.askedQuestions.join(", ")}.\n`
        + `User Response: ${userResponse}\n\nGenerate one short technical follow-up question.`;

    const response = await this.openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are a professional technical interviewer." },
        { role: "user", content: prompt }
      ],
    });
    return response.choices[0].message.content;
  }

  async processAudioInput(audioData) {
    try {
      if (!audioData || audioData.length === 0) {
        console.error("Received empty audio data.");
        return;
      }

      // 🔹 Accumulate audio chunks in the buffer
      this.audioBuffer.push(Buffer.from(audioData));

      // 🔹 Start audio processing if not already running
      if (!this.isProcessingAudio) {
        this.isProcessingAudio = true;
        this.startAudioProcessing();
      }

    } catch (error) {
      console.error('Error processing audio:', error);
      await this.speak("I'm sorry, I couldn't understand that. Could you please repeat?");
    }
  }

  startAudioProcessing() {
    this.processingInterval = setInterval(async () => {
      if (this.audioBuffer.length === 0) return;

      const tempAudioDir = path.join(__dirname, 'temp_audio');
      if (!fs.existsSync(tempAudioDir)) {
        fs.mkdirSync(tempAudioDir, { recursive: true });
      }

      const audioFilePath = path.join(tempAudioDir, `audio_${Date.now()}.wav`);

      const writer = new wav.FileWriter(audioFilePath, {
        channels: 1,
        sampleRate: 44000,
        bitDepth: 16
      });

      console.log(`Saving audio to file: ${audioFilePath}`);
      this.audioBuffer.forEach(chunk => writer.write(chunk));
      writer.end();

      writer.on('finish', async () => {
        console.log(`Audio file saved successfully: ${audioFilePath}`);

        try {
          const transcription = await this.openai.audio.transcriptions.create({
            file: fs.createReadStream(audioFilePath),
            model: "whisper-1",
            response_format: "text",
            language: "en"
          });

          const transcript = transcription;
          console.log(`User said: ${transcript}`);

          if (!transcript || transcript.trim() === '') {
            console.warn("Empty or undefined transcript received.");
            await this.speak("I couldn't hear you clearly. Could you repeat?");
            return;
          }

          if (this.userDoesntKnow(transcript)) {
            const lastTopic = this.askedQuestions.slice(-1)[0] || "unknown topic";
            this.dontKnowTopics.push(lastTopic);
            await this.speak(`No problem with ${lastTopic}. Let's move to a different topic.`);
          }

          const followUpQuestion = await this.generateFollowUp(transcript);
          this.askedQuestions.push(followUpQuestion);
          await this.speak(followUpQuestion);

        } catch (error) {
          console.error('Error processing audio:', error);
          await this.speak("I'm sorry, I couldn't understand that. Could you please repeat?");
        } finally {
          if (fs.existsSync(audioFilePath)) {
            try {
              fs.unlinkSync(audioFilePath);
              console.log(`Deleted temp file: ${audioFilePath}`);
            } catch (deleteError) {
              console.error(`Failed to delete temp file: ${audioFilePath}`, deleteError);
            }
          }
          this.audioBuffer = [];
        }
      });
    }, 10000);
  }

  stopAudioProcessing() {
    clearInterval(this.processingInterval);
    this.isProcessingAudio = false; // 🔹 Reset processing flag
    console.log("Stopped audio processing.");
  }


  async startInterview() {
    console.log("Starting interview...");
    await this.speak("Hello! Welcome to the interview. Let's begin with a few technical questions.");

    if (this.questions.length > 0) {
      const initialQuestion = this.questions[0];
      this.askedQuestions.push(initialQuestion);
      await this.speak(initialQuestion);
    }
  }
}

export default InterviewBot;