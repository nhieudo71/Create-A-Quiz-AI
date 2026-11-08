import React from 'react';
import { useQuizGeneratorContext } from '../../context/QuizGeneratorContext';
import { DocumentUploader } from './DocumentUploader';
import { GenerationConfigView } from './GenerationConfig';
import { RealtimeProgressBar } from './RealtimeProgressBar';
import { QuestionReviewList } from './QuestionReviewList';
import { QuestionItem } from '../../types/generator.types';

interface GeneratorContainerProps {
  onStartExamRoom?: (questions: QuestionItem[], subject: string, mode: 'PRACTICE' | 'EXAM') => void;
}

export const GeneratorContainer: React.FC<GeneratorContainerProps> = ({ onStartExamRoom }) => {
  const {
    step,
    docData,
    config,
    progress,
    questions,
    isLoading,
    errorMessage,
    elapsedSeconds,
    estimatedSeconds,
    handleUploadFile,
    handleUpdateConfig,
    handleStartGeneration,
    handleUpdateQuestion,
    handleDeleteQuestion,
    handleReset
  } = useQuizGeneratorContext();

  const handleStartPractice = (quizQuestions: QuestionItem[]) => {
    if (onStartExamRoom) {
      onStartExamRoom(quizQuestions, config.subjectName, 'EXAM');
    }
  };

  return (
    <div className="py-6 px-4">
      {step === 'UPLOAD' && (
        <DocumentUploader
          onFileSelected={handleUploadFile}
          isLoading={isLoading}
          errorMessage={errorMessage}
        />
      )}

      {step === 'CONFIG' && docData && (
        <GenerationConfigView
          docData={docData}
          config={config}
          onUpdateConfig={handleUpdateConfig}
          onStartGeneration={handleStartGeneration}
          onBack={handleReset}
        />
      )}

      {step === 'GENERATING' && (
        <RealtimeProgressBar
          progress={progress}
          subjectName={config.subjectName}
          elapsedSeconds={elapsedSeconds}
          estimatedSeconds={estimatedSeconds}
        />
      )}

      {step === 'REVIEW' && (
        <QuestionReviewList
          questions={questions}
          subjectName={config.subjectName}
          onUpdateQuestion={handleUpdateQuestion}
          onDeleteQuestion={handleDeleteQuestion}
          onReset={handleReset}
          onStartQuiz={handleStartPractice}
        />
      )}
    </div>
  );
};
