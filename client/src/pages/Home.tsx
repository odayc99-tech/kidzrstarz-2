import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import {
  Sparkles,
  Upload,
  CreditCard,
  Download,
  Shield,
  Clock,
  Zap,
  ArrowRight,
  Star,
  Wand2,
  Heart,
  BookOpen,
} from "lucide-react";
import TestimonialsSection from "@/components/TestimonialsSection";
import FAQSection from "@/components/FAQSection";
import GallerySection from "@/components/GallerySection";

const LOGO_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/kidzrstarz-logo_5f53c312.png";

export default function Home() {
  const { user, isAuthenticated, openSignIn } = useAuth();

  return (
    <div className="min-h-screen flex flex-col bg-white overflow-x-hidden">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-purple-100 shadow-sm">
        <div className="container flex items-center justify-between h-16">
          <Link href="/">
            <div className="flex items-center gap-2">
              <img src={LOGO_URL} alt="KidzRstarz" className="w-9 h-9 rounded-lg object-cover" />
              <span
                className="text-2xl font-bold bg-gradient-to-r from-purple-600 via-pink-500 to-orange-400 bg-clip-text text-transparent"
                style={{ fontFamily: "'Fredoka', sans-serif" }}
              >
                KidzRstarz
              </span>
            </div>
          </Link>
          <div className="flex items-center gap-4">
            <a
              href="#gallery"
              className="text-slate-600 hover:text-purple-600 text-sm font-medium hidden md:block transition-colors"
            >
              Gallery
            </a>
            <a
              href="#how-it-works"
              className="text-slate-600 hover:text-purple-600 text-sm font-medium hidden md:block transition-colors"
            >
              How It Works
            </a>
            <a
              href="#pricing"
              className="text-slate-600 hover:text-purple-600 text-sm font-medium hidden md:block transition-colors"
            >
              Pricing
            </a>
            <a
              href="#faq"
              className="text-slate-600 hover:text-purple-600 text-sm font-medium hidden md:block transition-colors"
            >
              FAQ
            </a>
            {isAuthenticated ? (
              <div className="flex items-center gap-3">
                <Link href="/dashboard">
                  <Button variant="outline" size="sm" className="border-purple-200 text-purple-700 hover:bg-purple-50 hidden sm:inline-flex">
                    My Account
                  </Button>
                </Link>
                <Link href="/upload">
                  <Button
                    size="sm"
                    className="bg-gradient-to-r from-purple-600 via-pink-500 to-orange-400 hover:from-purple-700 hover:via-pink-600 hover:to-orange-500 shadow-md"
                  >
                    Create Now
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" className="border-purple-200 text-purple-700 hover:bg-purple-50 hidden sm:inline-flex" onClick={() => openSignIn()}>
                    My Account
                  </Button>
                <Link href="/upload">
                  <Button
                    size="sm"
                    className="bg-gradient-to-r from-purple-600 via-pink-500 to-orange-400 hover:from-purple-700 hover:via-pink-600 hover:to-orange-500 shadow-md"
                  >
                    Create Now
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section - Magical & Fun */}
      <section className="relative py-16 md:py-24 overflow-hidden">
        {/* Animated gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-900 via-purple-800 to-pink-700" />

        {/* Animated stars / sparkles */}
        <div className="absolute inset-0 overflow-hidden">
          {/* Large floating orbs */}
          <div
            className="absolute w-96 h-96 rounded-full opacity-20 blur-3xl"
            style={{
              background: "radial-gradient(circle, #a855f7, transparent)",
              top: "-5%",
              left: "-10%",
              animation: "float 8s ease-in-out infinite",
            }}
          />
          <div
            className="absolute w-80 h-80 rounded-full opacity-20 blur-3xl"
            style={{
              background: "radial-gradient(circle, #ec4899, transparent)",
              bottom: "-10%",
              right: "-5%",
              animation: "float 10s ease-in-out infinite reverse",
            }}
          />
          <div
            className="absolute w-64 h-64 rounded-full opacity-15 blur-3xl"
            style={{
              background: "radial-gradient(circle, #3b82f6, transparent)",
              top: "30%",
              right: "20%",
              animation: "float 12s ease-in-out infinite",
            }}
          />

          {/* Twinkling stars */}
          {[...Array(20)].map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full bg-white"
              style={{
                width: `${Math.random() * 4 + 2}px`,
                height: `${Math.random() * 4 + 2}px`,
                top: `${Math.random() * 100}%`,
                left: `${Math.random() * 100}%`,
                opacity: Math.random() * 0.7 + 0.3,
                animation: `twinkle ${Math.random() * 3 + 2}s ease-in-out infinite`,
                animationDelay: `${Math.random() * 5}s`,
              }}
            />
          ))}
        </div>

        <div className="container relative z-10">
          <div className="flex flex-col lg:flex-row items-center gap-8 lg:gap-12">
            {/* Left: Text content */}
            <div className="flex-1 text-center lg:text-left">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/15 backdrop-blur-sm text-white rounded-full text-sm font-medium mb-6 border border-white/20">
                <Sparkles className="w-4 h-4 text-yellow-300" />
                AI-Powered Storybook Magic
                <Star className="w-4 h-4 text-yellow-300" />
              </div>

              <h1
                className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-white mb-6 leading-tight"
                style={{ fontFamily: "'Fredoka', sans-serif" }}
              >
                Where Every Kid{" "}
                <span className="relative inline-block">
                  <span className="bg-gradient-to-r from-yellow-300 via-pink-300 to-cyan-300 bg-clip-text text-transparent">
                    Becomes a Star
                  </span>
                  <svg
                    className="absolute -bottom-2 left-0 w-full"
                    viewBox="0 0 300 12"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M2 8C50 2 100 4 150 6C200 8 250 4 298 2"
                      stroke="url(#underline-grad)"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                    <defs>
                      <linearGradient id="underline-grad" x1="0" y1="0" x2="300" y2="0" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#fde047" />
                        <stop offset="0.5" stopColor="#f472b6" />
                        <stop offset="1" stopColor="#67e8f9" />
                      </linearGradient>
                    </defs>
                  </svg>
                </span>
              </h1>

              <p className="text-lg md:text-xl text-purple-100 mb-8 max-w-xl mx-auto lg:mx-0 leading-relaxed">
                Upload your child's photo and watch AI create a{" "}
                <span className="text-yellow-300 font-semibold">stunning animated character</span>,
                a personalized story, and an{" "}
                <span className="text-pink-300 font-semibold">animated storybook</span> with narration
                and music!
              </p>

              <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                {isAuthenticated ? (
                  <Link href="/upload">
                    <Button
                      size="lg"
                      className="bg-gradient-to-r from-yellow-400 via-orange-400 to-pink-500 hover:from-yellow-500 hover:via-orange-500 hover:to-pink-600 text-slate-900 font-bold text-lg px-8 py-6 rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105"
                    >
                      <Wand2 className="mr-2 w-5 h-5" />
                      Create Your Character
                    </Button>
                  </Link>
                ) : (
                  <Button
                      size="lg"
                      className="bg-gradient-to-r from-yellow-400 via-orange-400 to-pink-500 hover:from-yellow-500 hover:via-orange-500 hover:to-pink-600 text-slate-900 font-bold text-lg px-8 py-6 rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105"
                      onClick={() => openSignIn()}
                    >
                      <Wand2 className="mr-2 w-5 h-5" />
                      Start the Magic - $19.99
                    </Button>
                )}
                <a href="#how-it-works">
                  <Button
                    variant="outline"
                    size="lg"
                    className="text-lg px-8 py-6 rounded-full border-2 border-white/30 text-white hover:bg-white/10 bg-transparent backdrop-blur-sm"
                  >
                    See How It Works
                  </Button>
                </a>
              </div>

              <div className="flex items-center gap-6 mt-8 justify-center lg:justify-start">
                <div className="flex items-center gap-1.5 text-purple-200 text-sm">
                  <Shield className="w-4 h-4 text-green-400" />
                  Preview before you pay
                </div>
                <div className="flex items-center gap-1.5 text-purple-200 text-sm">
                  <Star className="w-4 h-4 text-yellow-400" />
                  100% satisfaction
                </div>
              </div>
            </div>

            {/* Right: Hero image */}
            <div className="flex-1 flex justify-center lg:justify-end relative">
              <div className="relative w-full max-w-lg">
                {/* Glow behind image */}
                <div
                  className="absolute inset-0 rounded-3xl blur-2xl opacity-50"
                  style={{
                    background:
                      "radial-gradient(ellipse, rgba(168,85,247,0.5), rgba(236,72,153,0.3), transparent)",
                    transform: "scale(1.1)",
                  }}
                />
                {/* Logo image */}
                <img
                  src={LOGO_URL}
                  alt="KidzRstarz - Magical animated character transformations"
                  className="relative w-full rounded-3xl shadow-2xl border-4 border-white/20"
                  style={{
                    animation: "heroFloat 6s ease-in-out infinite",
                  }}
                />
                {/* Floating badges around image */}
                <div
                  className="absolute -top-4 -left-4 bg-white rounded-2xl shadow-lg px-3 py-2 flex items-center gap-2"
                  style={{ animation: "badgeFloat 4s ease-in-out infinite" }}
                >
                  <span className="text-2xl">✨</span>
                  <span className="text-sm font-bold text-purple-700">AI Magic</span>
                </div>
                <div
                  className="absolute -bottom-4 -right-4 bg-white rounded-2xl shadow-lg px-3 py-2 flex items-center gap-2"
                  style={{ animation: "badgeFloat 5s ease-in-out infinite reverse" }}
                >
                  <span className="text-2xl">📖</span>
                  <span className="text-sm font-bold text-pink-600">Personalized Story</span>
                </div>
                <div
                  className="absolute top-1/2 -right-6 bg-white rounded-2xl shadow-lg px-3 py-2 flex items-center gap-2 hidden lg:flex"
                  style={{ animation: "badgeFloat 6s ease-in-out infinite" }}
                >
                  <span className="text-2xl">🎬</span>
                  <span className="text-sm font-bold text-orange-600">Animated Video</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom wave divider */}
        <div className="absolute bottom-0 left-0 right-0">
          <svg viewBox="0 0 1440 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
            <path
              d="M0 60C240 20 480 80 720 50C960 20 1200 70 1440 40V100H0V60Z"
              fill="white"
            />
          </svg>
        </div>
      </section>

      {/* Inline keyframe animations */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-20px); }
        }
        @keyframes heroFloat {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-12px) rotate(1deg); }
        }
        @keyframes badgeFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        @keyframes twinkle {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.5); }
        }
      `}</style>

      {/* Gallery */}
      <GallerySection />

      {/* How It Works */}
      <section id="how-it-works" className="py-20 bg-gradient-to-b from-white via-purple-50/40 to-white">
        <div className="container">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-purple-100 text-purple-700 rounded-full text-sm font-medium mb-6">
              <Wand2 className="w-4 h-4" />
              Simple as 1-2-3
            </div>
            <h2
              className="text-4xl md:text-5xl font-bold text-slate-900 mb-4"
              style={{ fontFamily: "'Fredoka', sans-serif" }}
            >
              How the{" "}
              <span className="bg-gradient-to-r from-purple-600 to-pink-500 bg-clip-text text-transparent">
                Magic
              </span>{" "}
              Happens
            </h2>
            <p className="text-xl text-slate-600 max-w-2xl mx-auto">
              Three simple steps to transform your child into a magical animated character
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Step 1 */}
            <Card className="text-center p-8 hover:shadow-xl transition-all duration-300 border-2 border-transparent hover:border-purple-200 group hover:-translate-y-1 bg-gradient-to-b from-white to-purple-50/50 rounded-3xl">
              <CardContent className="pt-6">
                <div className="w-20 h-20 bg-gradient-to-br from-purple-500 to-pink-500 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-lg group-hover:scale-110 transition-transform">
                  <Upload className="w-9 h-9 text-white" />
                </div>
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-purple-100 text-purple-700 font-bold text-sm mb-3">
                  1
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">Upload Photo</h3>
                <p className="text-slate-600">
                  Upload a clear photo of your child. Our AI works best with well-lit, front-facing photos.
                </p>
              </CardContent>
            </Card>

            {/* Step 2 */}
            <Card className="text-center p-8 hover:shadow-xl transition-all duration-300 border-2 border-transparent hover:border-pink-200 group hover:-translate-y-1 bg-gradient-to-b from-white to-pink-50/50 rounded-3xl">
              <CardContent className="pt-6">
                <div className="w-20 h-20 bg-gradient-to-br from-pink-500 to-orange-400 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-lg group-hover:scale-110 transition-transform">
                  <Sparkles className="w-9 h-9 text-white" />
                </div>
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-pink-100 text-pink-700 font-bold text-sm mb-3">
                  2
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">AI Transformation</h3>
                <p className="text-slate-600">
                  Our AI generates a stunning animated character, a personalized story, and an animated storybook.
                </p>
              </CardContent>
            </Card>

            {/* Step 3 */}
            <Card className="text-center p-8 hover:shadow-xl transition-all duration-300 border-2 border-transparent hover:border-orange-200 group hover:-translate-y-1 bg-gradient-to-b from-white to-orange-50/50 rounded-3xl">
              <CardContent className="pt-6">
                <div className="w-20 h-20 bg-gradient-to-br from-orange-400 to-yellow-400 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-lg group-hover:scale-110 transition-transform">
                  <BookOpen className="w-9 h-9 text-white" />
                </div>
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-orange-100 text-orange-700 font-bold text-sm mb-3">
                  3
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">Watch & Share</h3>
                <p className="text-slate-600">
                  Pay securely and enjoy your animated storybook with narration, music, and beautiful illustrations!
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Features - Why Choose */}
      <section className="py-20 bg-gradient-to-b from-purple-50/30 to-white">
        <div className="container">
          <div className="text-center mb-16">
            <h2
              className="text-4xl md:text-5xl font-bold text-slate-900 mb-4"
              style={{ fontFamily: "'Fredoka', sans-serif" }}
            >
              Why Families{" "}
              <span className="bg-gradient-to-r from-pink-500 to-purple-600 bg-clip-text text-transparent">
                Love
              </span>{" "}
              KidzRstarz
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {[
              {
                icon: <Zap className="w-6 h-6 text-white" />,
                gradient: "from-purple-500 to-indigo-500",
                bg: "bg-purple-50",
                title: "AI-Powered",
                desc: "State-of-the-art AI creates stunning movie-quality animated character transformations.",
              },
              {
                icon: <Clock className="w-6 h-6 text-white" />,
                gradient: "from-pink-500 to-rose-500",
                bg: "bg-pink-50",
                title: "Fast Results",
                desc: "Get your preview in minutes. Full storybook ready within 15 minutes.",
              },
              {
                icon: <Shield className="w-6 h-6 text-white" />,
                gradient: "from-green-500 to-emerald-500",
                bg: "bg-green-50",
                title: "Secure & Private",
                desc: "Your photos are encrypted and never shared. Deleted after processing.",
              },
              {
                icon: <CreditCard className="w-6 h-6 text-white" />,
                gradient: "from-orange-400 to-amber-500",
                bg: "bg-orange-50",
                title: "Preview First",
                desc: "See your character preview before paying. No surprises.",
              },
              {
                icon: <Heart className="w-6 h-6 text-white" />,
                gradient: "from-pink-500 to-purple-500",
                bg: "bg-pink-50",
                title: "Personalized Story",
                desc: "Each character comes with a unique AI-generated story featuring your child.",
              },
              {
                icon: <Download className="w-6 h-6 text-white" />,
                gradient: "from-blue-500 to-cyan-500",
                bg: "bg-blue-50",
                title: "High Resolution",
                desc: "Receive a 4K image perfect for printing, framing, or sharing on social media.",
              },
            ].map((feature, index) => (
              <div
                key={index}
                className={`flex gap-4 p-5 rounded-2xl ${feature.bg} hover:shadow-md transition-all duration-300 hover:-translate-y-0.5`}
              >
                <div
                  className={`flex-shrink-0 w-12 h-12 bg-gradient-to-br ${feature.gradient} rounded-xl flex items-center justify-center shadow-sm`}
                >
                  {feature.icon}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 mb-1">{feature.title}</h3>
                  <p className="text-slate-600 text-sm">{feature.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 bg-white">
        <div className="container">
          <div className="text-center mb-16">
            <h2
              className="text-4xl md:text-5xl font-bold text-slate-900 mb-4"
              style={{ fontFamily: "'Fredoka', sans-serif" }}
            >
              Simple{" "}
              <span className="bg-gradient-to-r from-purple-600 to-pink-500 bg-clip-text text-transparent">
                Pricing
              </span>
            </h2>
            <p className="text-xl text-slate-600">One price. Everything included.</p>
          </div>

          <div className="max-w-md mx-auto">
            <Card className="overflow-hidden border-2 border-purple-200 shadow-xl rounded-3xl hover:shadow-2xl transition-shadow">
              <div className="bg-gradient-to-r from-purple-600 via-pink-500 to-orange-400 p-8 text-center text-white relative overflow-hidden">
                {/* Decorative sparkles */}
                <div className="absolute top-3 left-6 text-2xl opacity-50">✨</div>
                <div className="absolute bottom-4 right-8 text-xl opacity-50">⭐</div>
                <h3
                  className="text-2xl font-bold mb-2"
                  style={{ fontFamily: "'Fredoka', sans-serif" }}
                >
                  Complete Storybook Package
                </h3>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-5xl font-bold">$29</span>
                  <span className="text-2xl">.99</span>
                </div>
                <p className="mt-2 text-white/80">per character</p>
              </div>
              <CardContent className="p-8">
                <ul className="space-y-4">
                  {[
                    { text: "Stunning animated character transformation", emoji: "🎨" },
                    { text: "Personalized AI-generated story", emoji: "📖" },
                    { text: "Animated storybook with narration", emoji: "🎬" },
                    { text: "Theme-matched background music", emoji: "🎵" },
                    { text: "High-resolution 4K image", emoji: "🖼️" },
                    { text: "Preview before you pay", emoji: "👀" },
                    { text: "Shareable link for family & friends", emoji: "🔗" },
                    { text: "All sales final after confirmation", emoji: "✅" },
                  ].map((feature, index) => (
                    <li key={index} className="flex items-center gap-3">
                      <span className="text-lg">{feature.emoji}</span>
                      <span className="text-slate-700">{feature.text}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-8">
                  {isAuthenticated ? (
                    <Link href="/upload">
                      <Button className="w-full bg-gradient-to-r from-purple-600 via-pink-500 to-orange-400 hover:from-purple-700 hover:via-pink-600 hover:to-orange-500 py-6 text-lg rounded-full shadow-md font-bold">
                        <Wand2 className="mr-2 w-5 h-5" />
                        Create Your Character
                      </Button>
                    </Link>
                  ) : (
                    <Button className="w-full bg-gradient-to-r from-purple-600 via-pink-500 to-orange-400 hover:from-purple-700 hover:via-pink-600 hover:to-orange-500 py-6 text-lg rounded-full shadow-md font-bold" onClick={() => openSignIn()}>
                        <Wand2 className="mr-2 w-5 h-5" />
                        Get Started Now
                      </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <TestimonialsSection />

      {/* FAQ */}
      <div id="faq">
        <FAQSection />
      </div>

      {/* Footer */}
      <footer className="bg-gradient-to-b from-slate-900 to-slate-950 text-slate-400 py-12">
        <div className="container">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-3">
              <img src={LOGO_URL} alt="KidzRstarz" className="w-10 h-10 rounded-lg object-cover" />
              <div>
                <span
                  className="text-xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-orange-400 bg-clip-text text-transparent"
                  style={{ fontFamily: "'Fredoka', sans-serif" }}
                >
                  KidzRstarz
                </span>
                <p className="text-sm mt-0.5">Where every kid becomes a star</p>
              </div>
            </div>
            <div className="flex gap-6 text-sm">
              <a href="#" className="hover:text-purple-400 transition-colors">
                Privacy Policy
              </a>
              <a href="#" className="hover:text-purple-400 transition-colors">
                Terms of Service
              </a>
              <a href="mailto:help@kidzrstarz.com" className="hover:text-purple-400 transition-colors">
                Contact
              </a>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t border-slate-800 text-center text-sm">
            <p>&copy; 2026 KidzRstarz. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
