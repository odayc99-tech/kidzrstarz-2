import { Check } from "lucide-react";

export interface Step {
  id: string;
  label: string;
  description?: string;
}

interface ProgressBarProps {
  steps: Step[];
  currentStep: number; // 0-indexed
  completedSteps?: number[]; // indices of completed steps
}

export function ProgressBar({
  steps,
  currentStep,
  completedSteps = [],
}: ProgressBarProps) {
  return (
    <div className="w-full py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Progress Line */}
        <div className="relative mb-8">
          {/* Background line */}
          <div className="absolute top-5 left-0 right-0 h-1 bg-gray-200" />

          {/* Filled line */}
          <div
            className="absolute top-5 left-0 h-1 bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-500"
            style={{
              width: `${(currentStep / (steps.length - 1)) * 100}%`,
            }}
          />

          {/* Step indicators */}
          <div className="relative flex justify-between">
            {steps.map((step, index) => {
              const isCompleted = completedSteps.includes(index);
              const isCurrent = index === currentStep;
              const isUpcoming = index > currentStep;

              return (
                <div key={step.id} className="flex flex-col items-center">
                  {/* Circle indicator */}
                  <div
                    className={`
                      w-10 h-10 rounded-full flex items-center justify-center
                      font-semibold text-sm transition-all duration-300
                      ${
                        isCompleted
                          ? "bg-green-500 text-white"
                          : isCurrent
                            ? "bg-gradient-to-r from-purple-500 to-blue-500 text-white ring-4 ring-purple-200"
                            : isUpcoming
                              ? "bg-gray-200 text-gray-500"
                              : "bg-gray-100 text-gray-400"
                      }
                    `}
                  >
                    {isCompleted ? (
                      <Check className="w-5 h-5" />
                    ) : (
                      <span>{index + 1}</span>
                    )}
                  </div>

                  {/* Label */}
                  <div className="mt-3 text-center">
                    <p
                      className={`
                        text-sm font-medium transition-colors duration-300
                        ${
                          isCurrent
                            ? "text-purple-600"
                            : isCompleted
                              ? "text-green-600"
                              : "text-gray-500"
                        }
                      `}
                    >
                      {step.label}
                    </p>
                    {step.description && (
                      <p className="text-xs text-gray-400 mt-1">
                        {step.description}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
