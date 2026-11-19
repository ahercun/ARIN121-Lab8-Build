import React, { useState, useRef } from 'react';
import {
  BookOpen,
  CheckCircle2,
  XCircle,
  RotateCcw,
  AlertCircle,
  Loader2,
  Sparkles,
  ArrowRight,
} from 'lucide-react';

interface Option {
  label: string;
  text: string;
}

interface Question {
  id: number;
  question: string;
  options: Option[];
}

interface QuestionResult {
  id: number;
  question: string;
  studentLetter: string;
  studentOptionText: string;
  correctLetter: string;
  correctOptionText: string;
  isCorrect: boolean;
  statusText: 'Correct' | 'Incorrect';
  explanation: string;
}

interface QuizSubmissionResult {
  scoreText: string;
  score: number;
  total: number;
  encouragement: string;
  results: QuestionResult[];
  invitePrompt: string;
}

const SAMPLE_NOTES = `Photosynthesis is the biological process by which green plants, algae, and cyanobacteria convert light energy into chemical energy stored in glucose. The process occurs in the chloroplasts, which contain the light-absorbing pigment chlorophyll. Photosynthesis consists of two consecutive stages: the light-dependent reactions and the light-independent Calvin cycle. In the light-dependent reactions, which take place across the thylakoid membranes, absorbed photons split water molecules into oxygen gas, protons, and electrons, while synthesizing ATP and NADPH. In the Calvin cycle, which occurs in the fluid-filled stroma, the enzyme RuBisCO fixes carbon dioxide to produce triose phosphate sugars that are subsequently assembled into glucose and starch.`;

export default function App() {
  const [notes, setNotes] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Quiz state
  const [quizId, setQuizId] = useState<string | null>(null);
  const [quizToken, setQuizToken] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
  const [unansweredHighlight, setUnansweredHighlight] = useState<number[]>([]);
  const [validationWarning, setValidationWarning] = useState<string | null>(null);

  // Results state
  const [submissionResult, setSubmissionResult] = useState<QuizSubmissionResult | null>(null);

  // References for scrolling to unanswered questions
  const questionRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const quizFormRef = useRef<HTMLDivElement | null>(null);

  const isQuizGenerated = questions.length === 3;
  const isQuizSubmitted = submissionResult !== null;

  // Handle quiz generation
  const handleGenerateQuiz = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedNotes = notes.trim();

    if (!trimmedNotes) {
      setGenerationError('Please paste your study notes before generating a quiz.');
      return;
    }

    // Check if notes are too short
    const wordCount = trimmedNotes.split(/\s+/).filter(Boolean).length;
    if (wordCount < 12 || trimmedNotes.length < 60) {
      setGenerationError(
        'Your study notes are too short to generate a three-question quiz. Please paste more material to continue.'
      );
      return;
    }

    setIsGenerating(true);
    setGenerationError(null);
    setValidationWarning(null);
    setUnansweredHighlight([]);
    setSubmissionResult(null);

    try {
      const response = await fetch('/api/generate-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: trimmedNotes }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setGenerationError(
          data.message || 'Could not generate quiz from these notes. Please provide more material.'
        );
        return;
      }

      setQuizId(data.quizId);
      setQuizToken(data.quizToken);
      setQuestions(data.questions);
      setSelectedAnswers({});
      setUnansweredHighlight([]);

      // Smooth scroll to the quiz form
      setTimeout(() => {
        quizFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } catch (err: any) {
      console.error(err);
      setGenerationError('A network error occurred. Please check your connection and try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Handle radio option select
  const handleOptionChange = (questionId: number, label: string) => {
    if (isQuizSubmitted) return; // Locked after submission
    setSelectedAnswers((prev) => ({
      ...prev,
      [questionId]: label,
    }));

    // Clear highlight for this question if it was highlighted
    if (unansweredHighlight.includes(questionId)) {
      setUnansweredHighlight((prev) => prev.filter((id) => id !== questionId));
    }
    if (validationWarning) {
      setValidationWarning(null);
    }
  };

  // Handle quiz submit
  const handleSubmitQuiz = async () => {
    if (isQuizSubmitted || isSubmitting) return;

    // Check which questions are unanswered
    const unanswered: number[] = [];
    questions.forEach((q) => {
      if (!selectedAnswers[q.id]) {
        unanswered.push(q.id);
      }
    });

    if (unanswered.length > 0) {
      setUnansweredHighlight(unanswered);
      setValidationWarning(
        `Please select an answer for question ${unanswered.join(', ')} before submitting.`
      );

      // Scroll to the first unanswered question
      const firstMissingId = unanswered[0];
      const targetElement = questionRefs.current[firstMissingId];
      if (targetElement) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    setIsSubmitting(true);
    setValidationWarning(null);
    setUnansweredHighlight([]);

    try {
      const response = await fetch('/api/submit-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quizId,
          quizToken,
          answers: selectedAnswers,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        if (data.missingQuestionIds) {
          setUnansweredHighlight(data.missingQuestionIds);
        }
        setValidationWarning(data.message || 'Error submitting answers. Please try again.');
        return;
      }

      setSubmissionResult(data);

      // Scroll to results area
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 150);
    } catch (err: any) {
      console.error(err);
      setValidationWarning('Failed to submit answers due to a network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Start Over: Clears quiz and results so student can paste new notes. Does not auto-generate.
  const handleStartOver = () => {
    setNotes('');
    setQuestions([]);
    setQuizId(null);
    setQuizToken(null);
    setSelectedAnswers({});
    setUnansweredHighlight([]);
    setValidationWarning(null);
    setGenerationError(null);
    setSubmissionResult(null);

    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col justify-between selection:bg-slate-200">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-2xl mx-auto px-4 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-sm shadow-sm">
              QQ
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Quick Quiz</h1>
          </div>
          <div className="text-xs text-slate-500 font-medium">
            3-Question Multiple Choice
          </div>
        </div>
      </header>

      {/* Main Single Centered Column */}
      <main className="max-w-2xl w-full mx-auto px-4 py-8 md:py-12 flex-1">
        {/* Intro */}
        <div className="mb-8">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 mb-2">
            Practice Quiz Assistant
          </h2>
          <p className="text-base text-slate-600 leading-relaxed">
            Paste your lecture notes, summaries, or textbook sections to generate a focused
            three-question practice quiz based strictly on your material.
          </p>
        </div>

        {/* Input Form Section */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 md:p-8 shadow-xs mb-8">
          <form onSubmit={handleGenerateQuiz} noValidate>
            <div className="flex items-center justify-between mb-2">
              <label
                htmlFor="notes-input"
                className="block text-base font-semibold text-slate-900"
              >
                Paste your study notes here
              </label>
              {!isQuizGenerated && (
                <button
                  type="button"
                  onClick={() => setNotes(SAMPLE_NOTES)}
                  className="text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors cursor-pointer underline underline-offset-4"
                >
                  Use sample notes
                </button>
              )}
            </div>

            <textarea
              id="notes-input"
              rows={7}
              disabled={isGenerating || isQuizGenerated}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                if (generationError) setGenerationError(null);
              }}
              placeholder="Paste your study notes here to generate a three-question quiz..."
              className={`w-full p-4 rounded-lg border text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 transition-all resize-y ${
                isQuizGenerated
                  ? 'bg-slate-50 border-slate-200 text-slate-600 cursor-not-allowed'
                  : generationError
                  ? 'border-red-400 bg-red-50/20'
                  : 'border-slate-300 bg-white'
              }`}
            />

            {/* Error Message for Notes (e.g. Too short or empty) */}
            {generationError && (
              <div
                role="alert"
                className="mt-3 p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm flex items-start gap-2.5 animate-in fade-in"
              >
                <AlertCircle className="w-5 h-5 shrink-0 text-red-600 mt-0.5" />
                <div className="leading-snug">{generationError}</div>
              </div>
            )}

            {/* Button below input */}
            <div className="mt-5 flex items-center justify-between">
              {!isQuizGenerated ? (
                <button
                  type="submit"
                  disabled={!notes.trim() || isGenerating}
                  className={`w-full sm:w-auto px-6 py-3 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer ${
                    !notes.trim() || isGenerating
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      : 'bg-slate-900 text-white hover:bg-slate-800 active:scale-[0.99]'
                  }`}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generating Quiz...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Generate Quiz
                    </>
                  )}
                </button>
              ) : (
                <div className="flex items-center justify-between w-full text-xs text-slate-500">
                  <span className="flex items-center gap-1.5 font-medium text-slate-700">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Quiz generated from study notes
                  </span>
                  <button
                    type="button"
                    onClick={handleStartOver}
                    className="text-slate-600 hover:text-slate-900 font-semibold underline underline-offset-4 cursor-pointer"
                  >
                    Edit notes
                  </button>
                </div>
              )}
            </div>
          </form>
        </div>

        {/* Loading Indicator while quiz is generating */}
        {isGenerating && (
          <div className="py-12 px-6 text-center bg-white rounded-xl border border-slate-200 shadow-xs mb-8 animate-in fade-in">
            <Loader2 className="w-8 h-8 text-slate-800 animate-spin mx-auto mb-3" />
            <h3 className="text-base font-semibold text-slate-900">
              Analyzing study material...
            </h3>
            <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
              Creating three multiple-choice questions based strictly on your notes.
            </p>
          </div>
        )}

        {/* Quiz Questions Section */}
        {isQuizGenerated && (
          <div ref={quizFormRef} className="space-y-6 mb-8 animate-in fade-in">
            <div className="border-b border-slate-200 pb-3 flex items-center justify-between">
              <h2 className="text-xl font-bold tracking-tight text-slate-900">
                Practice Questions
              </h2>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                3 Questions
              </span>
            </div>

            {/* Validation Alert for Unanswered Questions */}
            {validationWarning && (
              <div
                role="alert"
                className="p-4 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-sm flex items-start gap-3 shadow-xs animate-in fade-in"
              >
                <AlertCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">{validationWarning}</p>
                  <p className="text-xs text-amber-800 mt-0.5">
                    All three questions must be answered before your quiz can be evaluated.
                  </p>
                </div>
              </div>
            )}

            {/* Render Question 1, 2, 3 */}
            {questions.map((q) => {
              const isHighlighted = unansweredHighlight.includes(q.id);
              const selectedValue = selectedAnswers[q.id];

              return (
                <div
                  key={q.id}
                  ref={(el) => {
                    questionRefs.current[q.id] = el;
                  }}
                  className={`bg-white rounded-xl border p-6 transition-all shadow-xs ${
                    isHighlighted
                      ? 'border-red-400 ring-2 ring-red-100'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {/* Question Header */}
                  <div className="flex items-start gap-3 mb-4">
                    <span className="w-7 h-7 rounded-full bg-slate-100 text-slate-800 font-bold text-sm flex items-center justify-center shrink-0 border border-slate-200">
                      {q.id}
                    </span>
                    <h3 className="text-lg font-medium text-slate-900 leading-snug pt-0.5">
                      {q.question}
                    </h3>
                  </div>

                  {isHighlighted && (
                    <p className="text-xs font-semibold text-red-600 mb-3 pl-10 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      Please select an option for Question {q.id}
                    </p>
                  )}

                  {/* Options A, B, C, D */}
                  <div
                    className="space-y-2.5 pl-0 sm:pl-10"
                    role="radiogroup"
                    aria-labelledby={`q-${q.id}-label`}
                  >
                    {q.options.map((opt) => {
                      const inputId = `q-${q.id}-opt-${opt.label}`;
                      const isChecked = selectedValue === opt.label;

                      return (
                        <label
                          key={opt.label}
                          htmlFor={inputId}
                          className={`flex items-start gap-3.5 p-3.5 rounded-lg border text-sm transition-all cursor-pointer ${
                            isQuizSubmitted
                              ? isChecked
                                ? 'bg-slate-100 border-slate-300 cursor-default'
                                : 'bg-slate-50/50 border-slate-200 opacity-70 cursor-default'
                              : isChecked
                              ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                              : 'bg-white border-slate-200 hover:border-slate-400 hover:bg-slate-50/70 text-slate-800'
                          }`}
                        >
                          <div className="pt-0.5">
                            <input
                              type="radio"
                              id={inputId}
                              name={`question-${q.id}`}
                              value={opt.label}
                              checked={isChecked}
                              disabled={isQuizSubmitted}
                              onChange={() => handleOptionChange(q.id, opt.label)}
                              className="w-4 h-4 text-slate-900 border-slate-300 focus:ring-slate-900 cursor-pointer disabled:cursor-not-allowed"
                            />
                          </div>
                          <div className="flex-1">
                            <span
                              className={`font-bold mr-2 ${
                                isChecked && !isQuizSubmitted ? 'text-white' : 'text-slate-900'
                              }`}
                            >
                              {opt.label}.
                            </span>
                            <span
                              className={`leading-relaxed ${
                                isChecked && !isQuizSubmitted ? 'text-slate-100' : 'text-slate-700'
                              }`}
                            >
                              {opt.text}
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Submit Button (only when quiz is not yet submitted) */}
            {!isQuizSubmitted && (
              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={handleSubmitQuiz}
                  disabled={isSubmitting}
                  className="w-full sm:w-auto px-8 py-3.5 rounded-lg bg-slate-900 text-white font-semibold text-base hover:bg-slate-800 transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer active:scale-[0.99] disabled:bg-slate-300 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Evaluating Answers...
                    </>
                  ) : (
                    <>
                      Submit Answers
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Results Area */}
        {submissionResult && (
          <div
            ref={resultsRef}
            className="bg-white rounded-xl border border-slate-200 p-6 md:p-8 shadow-xs mb-8 animate-in fade-in space-y-6"
          >
            {/* Top Score Banner */}
            <div className="border-b border-slate-200 pb-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <span className="text-xs font-bold tracking-wider uppercase text-slate-500">
                    Quiz Results
                  </span>
                  <div className="text-3xl font-extrabold text-slate-900 mt-1">
                    {submissionResult.scoreText}
                  </div>
                </div>
                <div
                  className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-semibold border ${
                    submissionResult.score === 3
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : submissionResult.score === 2
                      ? 'bg-slate-100 text-slate-800 border-slate-300'
                      : 'bg-amber-50 text-amber-800 border-amber-200'
                  }`}
                >
                  {submissionResult.score === 3 ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <BookOpen className="w-4 h-4 text-slate-700" />
                  )}
                  <span>
                    {submissionResult.score === 3
                      ? 'All Correct'
                      : `${submissionResult.score} of 3 Correct`}
                  </span>
                </div>
              </div>
              <p className="text-sm text-slate-600 mt-3 leading-relaxed">
                {submissionResult.encouragement}
              </p>
            </div>

            {/* Per-Question Detailed Breakdown */}
            <div className="space-y-5">
              <h3 className="text-base font-bold text-slate-900">
                Detailed Answer Review
              </h3>

              {submissionResult.results.map((res) => {
                return (
                  <div
                    key={res.id}
                    className={`p-5 rounded-lg border transition-all ${
                      res.isCorrect
                        ? 'bg-emerald-50/40 border-emerald-200'
                        : 'bg-red-50/40 border-red-200'
                    }`}
                  >
                    {/* Status header with both color and explicit text */}
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-slate-800">
                        Question {res.id}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-md border ${
                          res.isCorrect
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                            : 'bg-red-100 text-red-800 border-red-300'
                        }`}
                      >
                        {res.isCorrect ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                            Correct
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3.5 h-3.5 text-red-700" />
                            Incorrect
                          </>
                        )}
                      </span>
                    </div>

                    <p className="text-base font-medium text-slate-900 mb-3">
                      {res.question}
                    </p>

                    {/* Answer Comparisons */}
                    <div className="space-y-1.5 text-sm mb-3">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-semibold text-slate-500 w-28 shrink-0">
                          Your Answer:
                        </span>
                        <span
                          className={`font-medium ${
                            res.isCorrect ? 'text-emerald-900' : 'text-red-800 line-through'
                          }`}
                        >
                          Option {res.studentLetter}: {res.studentOptionText}
                        </span>
                      </div>

                      {!res.isCorrect && (
                        <div className="flex items-baseline gap-2">
                          <span className="text-xs font-semibold text-slate-500 w-28 shrink-0">
                            Correct Answer:
                          </span>
                          <span className="font-semibold text-slate-900">
                            Option {res.correctLetter}: {res.correctOptionText}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Explanation */}
                    <div
                      className={`text-xs p-3 rounded-md border ${
                        res.isCorrect
                          ? 'bg-white/80 border-emerald-100 text-slate-700'
                          : 'bg-white/80 border-red-100 text-slate-700'
                      }`}
                    >
                      <span className="font-semibold text-slate-900 block mb-0.5">
                        Explanation from notes:
                      </span>
                      <span className="leading-relaxed">{res.explanation}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Closing prompt & Start Over Button */}
            <div className="border-t border-slate-200 pt-5 flex flex-col sm:flex-row items-center justify-between gap-4">
              <p className="text-xs text-slate-500 text-center sm:text-left leading-relaxed">
                {submissionResult.invitePrompt}
              </p>
              <button
                type="button"
                onClick={handleStartOver}
                className="w-full sm:w-auto px-5 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-sm transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer"
              >
                <RotateCcw className="w-4 h-4 text-slate-600" />
                Start Over
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 py-6 bg-white">
        <div className="max-w-2xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>Quick Quiz · University Practice Assistant</span>
          <span>Answers evaluated strictly from supplied study material</span>
        </div>
      </footer>
    </div>
  );
}
