import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

app.use(express.json({ limit: '2mb' }));

// Shared Gemini client utility (User-Agent header set to 'aistudio-build' as required)
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

interface QuizQuestion {
  id: number;
  question: string;
  options: { label: string; text: string }[];
  correctOption: string;
  explanation: string;
}

interface StoredQuiz {
  quizId: string;
  questions: QuizQuestion[];
  notes: string;
  createdAt: number;
}

// In-memory quiz cache
const quizCache = new Map<string, StoredQuiz>();

// Periodic cleanup of older quizzes (TTL: 2 hours)
setInterval(() => {
  const now = Date.now();
  for (const [id, quiz] of quizCache.entries()) {
    if (now - quiz.createdAt > 2 * 60 * 60 * 1000) {
      quizCache.delete(id);
    }
  }
}, 10 * 60 * 1000);

const SYSTEM_INSTRUCTION = `
<identity>
You are a practice quiz assistant for university students.
</identity>

<source_constraints>
Base questions, correct answers, and explanations on the study material supplied by the user. If no material is supplied, ask for it before generating a quiz.
</source_constraints>

<knowledge_check_module>
<purpose>
Turn the study material the student provides into a short multiple-choice quiz that tests their understanding and hold back all feedback until they have committed to their answers.
</purpose>

<building_the_quiz>
- Read the supplied material and write exactly three questions based on it.
- Draw on the material only. Do not test knowledge that isn't in it.
- Spread the questions across different parts of the material where possible.
- Number the questions 1, 2, and 3.
- Give every question four answer choices, labelled A, B, C, and D.
- Make sure each question has exactly one correct answer. The other three options should be plausible but clearly wrong according to the material.
- Vary which letter holds the correct answer across questions so there is no obvious pattern (for example: question 1 is B, question 2 is D, question 3 is A).
</building_the_quiz>

<evaluating_notes_sufficiency>
Evaluate whether the supplied study notes provide enough substance to write three distinct, factual multiple choice questions with 4 plausible options each.
If the notes are too short, empty, or too sparse to support three questions, set sufficientMaterial to false and provide a friendly explanation in insufficientReason asking for more material.
</evaluating_notes_sufficiency>
</knowledge_check_module>
`;

// Helper: Token encryption/encoding for server-stateless fallback
const SECRET_KEY = process.env.GEMINI_API_KEY || 'quick-quiz-secret-key-2026';

function createQuizPayloadToken(quiz: StoredQuiz): string {
  const jsonStr = JSON.stringify({
    quizId: quiz.quizId,
    questions: quiz.questions,
    createdAt: quiz.createdAt,
  });
  const iv = crypto.randomBytes(16);
  const key = crypto.createHash('sha256').update(SECRET_KEY).digest();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(jsonStr, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decodeQuizPayloadToken(token: string): StoredQuiz | null {
  try {
    const raw = Buffer.from(token, 'base64');
    if (raw.length < 32) return null;
    const iv = raw.subarray(0, 16);
    const tag = raw.subarray(16, 32);
    const encrypted = raw.subarray(32);
    const key = crypto.createHash('sha256').update(SECRET_KEY).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch (err) {
    console.error('Failed to decrypt quiz token:', err);
    return null;
  }
}

// API: Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// API: Generate Quiz
app.post('/api/generate-quiz', async (req, res) => {
  try {
    const { notes } = req.body;

    if (!notes || typeof notes !== 'string' || notes.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'empty_notes',
        message: 'Please paste your study notes before generating a quiz.',
      });
    }

    const trimmedNotes = notes.trim();

    // Client-side quick check: if notes have fewer than 12 words or under 60 characters
    const wordCount = trimmedNotes.split(/\s+/).filter(Boolean).length;
    if (wordCount < 12 || trimmedNotes.length < 60) {
      return res.status(400).json({
        success: false,
        error: 'too_short',
        message: 'Your study notes are too short to support a three-question quiz. Please paste more material to continue.',
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'missing_key',
        message: 'Gemini API key is not configured on the server. Please check the Secrets panel.',
      });
    }

    // Call Gemini 3.8 Flash
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: `Study notes supplied by the student:\n\n${trimmedNotes}\n\nPlease generate a three-question multiple-choice practice quiz based strictly on the supplied study notes.`,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sufficientMaterial: {
              type: Type.BOOLEAN,
              description: 'Whether the study notes contain sufficient factual information to create 3 high-quality questions.',
            },
            insufficientReason: {
              type: Type.STRING,
              description: 'Clear, polite explanation asking the student for more study material if notes are too brief or insufficient.',
            },
            questions: {
              type: Type.ARRAY,
              description: 'Array of exactly three multiple choice questions.',
              items: {
                type: Type.OBJECT,
                properties: {
                  id: {
                    type: Type.INTEGER,
                    description: 'Question number: 1, 2, or 3.',
                  },
                  question: {
                    type: Type.STRING,
                    description: 'The question text testing understanding of the notes.',
                  },
                  options: {
                    type: Type.ARRAY,
                    description: 'Four answer choices labelled A, B, C, and D.',
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        label: {
                          type: Type.STRING,
                          description: 'Option letter: A, B, C, or D.',
                        },
                        text: {
                          type: Type.STRING,
                          description: 'The text for this option.',
                        },
                      },
                      required: ['label', 'text'],
                    },
                  },
                  correctOption: {
                    type: Type.STRING,
                    description: 'The single correct option letter: A, B, C, or D.',
                  },
                  explanation: {
                    type: Type.STRING,
                    description: 'Brief explanation why this option is correct, drawing on the notes.',
                  },
                },
                required: ['id', 'question', 'options', 'correctOption', 'explanation'],
              },
            },
          },
          required: ['sufficientMaterial'],
        },
      },
    });

    const textOutput = response.text?.trim() || '{}';
    let parsedData: any;
    try {
      parsedData = JSON.parse(textOutput);
    } catch {
      return res.status(502).json({
        success: false,
        error: 'invalid_format',
        message: 'Could not parse the quiz response. Please try generating again.',
      });
    }

    if (!parsedData.sufficientMaterial || !Array.isArray(parsedData.questions) || parsedData.questions.length < 3) {
      return res.status(400).json({
        success: false,
        error: 'too_short',
        message:
          parsedData.insufficientReason ||
          'Your study notes are too brief to generate three distinct questions. Please paste a longer or more detailed section of notes.',
      });
    }

    // Ensure questions are sorted 1, 2, 3 and have normalized option labels
    const rawQuestions: any[] = parsedData.questions.slice(0, 3);
    const questions: QuizQuestion[] = rawQuestions.map((q, idx) => {
      const qNum = idx + 1;
      const opts = Array.isArray(q.options)
        ? q.options.map((opt: any, optIdx: number) => {
            const letter = ['A', 'B', 'C', 'D'][optIdx] || opt.label?.toUpperCase() || 'A';
            return {
              label: letter,
              text: String(opt.text || '').trim(),
            };
          })
        : [];

      return {
        id: qNum,
        question: String(q.question || '').trim(),
        options: opts,
        correctOption: String(q.correctOption || 'A').trim().toUpperCase(),
        explanation: String(q.explanation || '').trim(),
      };
    });

    // Check letter variance: if all 3 correct letters are identical, adjust them
    const letters = questions.map((q) => q.correctOption);
    if (letters[0] === letters[1] && letters[1] === letters[2]) {
      // Rotate option of second and third if needed so letters vary
      const targetLetters = ['A', 'B', 'C'];
      questions.forEach((q, i) => {
        const curCorrectIdx = q.options.findIndex((o) => o.label === q.correctOption);
        const desiredLetter = targetLetters[i];
        const desiredIdx = q.options.findIndex((o) => o.label === desiredLetter);
        if (curCorrectIdx >= 0 && desiredIdx >= 0 && curCorrectIdx !== desiredIdx) {
          // Swap option texts so the correct answer lands on desiredLetter
          const tempText = q.options[curCorrectIdx].text;
          q.options[curCorrectIdx].text = q.options[desiredIdx].text;
          q.options[desiredIdx].text = tempText;
          q.correctOption = desiredLetter;
        }
      });
    }

    const quizId = crypto.randomUUID();
    const storedQuiz: StoredQuiz = {
      quizId,
      questions,
      notes: trimmedNotes,
      createdAt: Date.now(),
    };

    quizCache.set(quizId, storedQuiz);

    // Create encrypted token payload so server can decrypt if memory cache is purged
    const quizToken = createQuizPayloadToken(storedQuiz);

    // Return to client WITHOUT correct answers or explanations
    const clientQuestions = questions.map((q) => ({
      id: q.id,
      question: q.question,
      options: q.options.map((opt) => ({
        label: opt.label,
        text: opt.text,
      })),
    }));

    return res.json({
      success: true,
      quizId,
      quizToken,
      questions: clientQuestions,
    });
  } catch (error: any) {
    console.error('Quiz generation error:', error);
    return res.status(500).json({
      success: false,
      error: 'server_error',
      message: error?.message || 'An error occurred while generating the quiz. Please try again.',
    });
  }
});

// API: Submit Quiz Answers
app.post('/api/submit-quiz', async (req, res) => {
  try {
    const { quizId, answers, quizToken } = req.body;

    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'missing_answers',
        message: 'No answers were received.',
      });
    }

    // Retrieve quiz from cache or decrypt token
    let storedQuiz = quizId ? quizCache.get(quizId) : null;
    if (!storedQuiz && quizToken) {
      storedQuiz = decodeQuizPayloadToken(quizToken);
    }

    if (!storedQuiz) {
      return res.status(404).json({
        success: false,
        error: 'quiz_expired',
        message: 'Quiz session has expired. Please paste your notes and generate a new quiz.',
      });
    }

    // Check if any question is unanswered
    const missingQuestionIds: number[] = [];
    for (const q of storedQuiz.questions) {
      const selected = answers[q.id];
      if (!selected || typeof selected !== 'string' || selected.trim() === '') {
        missingQuestionIds.push(q.id);
      }
    }

    if (missingQuestionIds.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'incomplete_submission',
        message: `Please answer question ${missingQuestionIds.join(', ')} before submitting.`,
        missingQuestionIds,
      });
    }

    // Mark answers against study notes and correct options
    let score = 0;
    const results = storedQuiz.questions.map((q) => {
      const studentLetter = String(answers[q.id] || '').trim().toUpperCase();
      const correctLetter = q.correctOption.trim().toUpperCase();
      const isCorrect = studentLetter === correctLetter;
      if (isCorrect) {
        score += 1;
      }

      const studentOptionObj = q.options.find((o) => o.label.toUpperCase() === studentLetter);
      const correctOptionObj = q.options.find((o) => o.label.toUpperCase() === correctLetter);

      return {
        id: q.id,
        question: q.question,
        studentLetter,
        studentOptionText: studentOptionObj ? studentOptionObj.text : '',
        correctLetter,
        correctOptionText: correctOptionObj ? correctOptionObj.text : '',
        isCorrect,
        statusText: isCorrect ? 'Correct' : 'Incorrect',
        explanation: q.explanation || 'Based on the supplied study material.',
      };
    });

    let encouragement = 'Good effort! Review the explanations below to reinforce your understanding.';
    if (score === 3) {
      encouragement = 'Outstanding! You answered every question correctly based on your study notes.';
    } else if (score === 2) {
      encouragement = 'Great work! You have a strong grasp of the material.';
    }

    return res.json({
      success: true,
      scoreText: `Score: ${score}/3`,
      score,
      total: 3,
      encouragement,
      results,
      invitePrompt: 'Feel free to ask questions about your study notes or start over for more practice.',
    });
  } catch (error: any) {
    console.error('Quiz submission error:', error);
    return res.status(500).json({
      success: false,
      error: 'server_error',
      message: error?.message || 'An error occurred while marking the quiz.',
    });
  }
});

// Setup Vite middleware in dev or static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    server: {
      middlewareMode: true,
      hmr: false,
    },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.listen(port, '0.0.0.0', () => {
  console.log(`Quick Quiz server running on http://0.0.0.0:${port}`);
});
