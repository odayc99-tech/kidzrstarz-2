/**
 * StorybookSkeleton — animated loading screen for the Storybook page.
 * Shows a branded full-page shimmer while order data is being fetched.
 */
export function StorybookSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 animate-in fade-in duration-300">
      {/* Sticky header skeleton */}
      <div className="sticky top-0 z-10 bg-slate-900/80 backdrop-blur-sm border-b border-slate-700/50">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="h-8 w-24 rounded-lg bg-slate-700/60 animate-pulse" />
          <div className="h-5 w-48 rounded-lg bg-slate-700/60 animate-pulse" />
          <div className="h-8 w-8 rounded-full bg-slate-700/60 animate-pulse" />
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Branded loading hero */}
        <div className="flex flex-col items-center justify-center py-10">
          {/* Animated star burst */}
          <div className="relative mb-6">
            <div className="w-20 h-20 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 flex items-center justify-center animate-pulse shadow-lg shadow-purple-900/60">
              <svg
                className="w-10 h-10 text-white"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </div>
            {/* Orbiting dots */}
            <div className="absolute inset-0 animate-spin" style={{ animationDuration: "3s" }}>
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-yellow-400 shadow-sm shadow-yellow-400/60" />
            </div>
            <div className="absolute inset-0 animate-spin" style={{ animationDuration: "2s", animationDirection: "reverse" }}>
              <div className="absolute top-1/2 -right-1 -translate-y-1/2 w-2 h-2 rounded-full bg-pink-400 shadow-sm shadow-pink-400/60" />
            </div>
            <div className="absolute inset-0 animate-spin" style={{ animationDuration: "4s" }}>
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-purple-300 shadow-sm shadow-purple-300/60" />
            </div>
          </div>

          <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">
            Loading Your Storybook
          </h2>
          <p className="text-slate-400 text-sm mb-6">
            Preparing your magical adventure...
          </p>

          {/* Animated progress bar */}
          <div className="w-64 h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-purple-500 via-pink-500 to-purple-500 rounded-full animate-[shimmer_1.5s_ease-in-out_infinite] bg-[length:200%_100%]" />
          </div>
        </div>

        {/* Story Player skeleton */}
        <div className="rounded-2xl bg-slate-800/60 border border-slate-700/50 overflow-hidden">
          {/* Scene strip */}
          <div className="flex gap-2 p-4 overflow-hidden">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="flex-shrink-0 w-24 h-24 rounded-xl bg-slate-700/60 animate-pulse"
                style={{ animationDelay: `${i * 0.1}s` }}
              />
            ))}
          </div>
          {/* Main scene image */}
          <div className="aspect-video bg-slate-700/60 animate-pulse mx-4 mb-4 rounded-xl" />
          {/* Scene text */}
          <div className="px-4 pb-4 space-y-2">
            <div className="h-4 bg-slate-700/60 rounded animate-pulse w-3/4" />
            <div className="h-4 bg-slate-700/60 rounded animate-pulse w-1/2" />
          </div>
        </div>

        {/* Video card skeleton */}
        <div className="rounded-2xl bg-slate-800/60 border border-slate-700/50 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-5 h-5 rounded bg-slate-700/60 animate-pulse" />
            <div className="h-5 w-48 rounded bg-slate-700/60 animate-pulse" />
          </div>
          <div className="aspect-video bg-slate-700/60 animate-pulse rounded-xl" />
        </div>

        {/* Story text skeleton */}
        <div className="rounded-2xl bg-slate-800/60 border border-slate-700/50 p-6 space-y-3">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-5 h-5 rounded bg-slate-700/60 animate-pulse" />
            <div className="h-5 w-24 rounded bg-slate-700/60 animate-pulse" />
          </div>
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-4 bg-slate-700/60 rounded animate-pulse"
              style={{
                width: `${[95, 88, 92, 75, 60][i - 1]}%`,
                animationDelay: `${i * 0.07}s`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
