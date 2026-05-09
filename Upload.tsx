import { useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { THEME_OPTIONS, LOGO_URL } from "@/const";
import { generateGuestToken, setGuestToken, getGuestToken } from "@/lib/guestToken";
import { useAuth } from "@/_core/hooks/useAuth";
import NavBar from "@/components/NavBar";
import { Upload as UploadIcon, Wand2, ChevronRight, ChevronLeft, CheckCircle, Sparkles, X } from "lucide-react";

type Step = "photo" | "details" | "theme" | "generating";

export default function UploadPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [step, setStep] = useState<Step>("photo");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [childName, setChildName] = useState("");
  const [childAge, setChildAge] = useState("");
  const [selectedTheme, setSelectedTheme] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadImage = trpc.orders.uploadImage.useMutation();
  const createOrder = trpc.orders.createOrder.useMutation();

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image must be under 10MB");
      return;
    }
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setPhotoPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, []);

  const handleSubmit = async () => {
    if (!photoFile || !photoPreview || !childName || !selectedTheme) {
      toast.error("Please fill in all required fields");
      return;
    }

    setStep("generating");

    try {
      // Upload image
      const base64 = photoPreview.split(",")[1];
      const mimeType = photoFile.type;
      const { url: imageUrl } = await uploadImage.mutateAsync({ base64, mimeType });

      // Get or create guest token
      let guestToken = getGuestToken();
      if (!guestToken) {
        guestToken = generateGuestToken();
        setGuestToken(guestToken);
      }

      // Create order
      const { orderId } = await createOrder.mutateAsync({
        guestToken: user ? undefined : guestToken,
        storyTheme: selectedTheme,
        childName,
        childAge: childAge || "5",
        originalImageUrl: imageUrl,
      });

      // Navigate to checkout/preview page
      navigate(`/checkout?orderId=${orderId}${!user ? `&guestToken=${guestToken}` : ""}`);
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong. Please try again.");
      setStep("photo");
    }
  };

  const steps = [
    { id: "photo", label: "Photo" },
    { id: "details", label: "Details" },
    { id: "theme", label: "Theme" },
  ];

  const currentStepIndex = steps.findIndex((s) => s.id === step);

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-50 to-white">
      <NavBar />

      <div className="container py-10 max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-purple-100 text-purple-700 rounded-full text-sm font-medium mb-4">
            <Sparkles className="w-4 h-4" />
            Create Your Storybook
          </div>
          <h1 className="text-4xl font-bold text-slate-900 mb-2" style={{ fontFamily: "'Fredoka', sans-serif" }}>
            Let's Make the Magic!
          </h1>
          <p className="text-slate-600">Upload your child's photo and we'll create a Pixar-style storybook</p>
        </div>

        {/* Step indicator */}
        {step !== "generating" && (
          <div className="flex items-center justify-center gap-4 mb-8">
            {steps.map((s, i) => (
              <div key={s.id} className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                  i < currentStepIndex
                    ? "bg-green-500 text-white"
                    : i === currentStepIndex
                    ? "bg-gradient-to-br from-purple-600 to-pink-500 text-white shadow-lg"
                    : "bg-slate-200 text-slate-500"
                }`}>
                  {i < currentStepIndex ? <CheckCircle className="w-4 h-4" /> : i + 1}
                </div>
                <span className={`text-sm font-medium hidden sm:block ${i === currentStepIndex ? "text-purple-700" : "text-slate-500"}`}>
                  {s.label}
                </span>
                {i < steps.length - 1 && (
                  <div className={`w-8 h-0.5 ${i < currentStepIndex ? "bg-green-400" : "bg-slate-200"}`} />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Step content */}
        <div className="bg-white rounded-3xl shadow-xl p-8 border border-purple-100">
          {/* Step 1: Photo */}
          {step === "photo" && (
            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2" style={{ fontFamily: "'Fredoka', sans-serif" }}>
                Upload Your Child's Photo
              </h2>
              <p className="text-slate-600 mb-6">Use a clear, well-lit, front-facing photo for best results</p>

              {!photoPreview ? (
                <div
                  className={`border-3 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all ${
                    isDragging
                      ? "border-purple-500 bg-purple-50"
                      : "border-purple-200 hover:border-purple-400 hover:bg-purple-50/50"
                  }`}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
                    <UploadIcon className="w-8 h-8 text-white" />
                  </div>
                  <p className="text-lg font-semibold text-slate-700 mb-2">Drop photo here or click to browse</p>
                  <p className="text-sm text-slate-500">JPG, PNG, WEBP up to 10MB</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                  />
                </div>
              ) : (
                <div className="relative">
                  <img src={photoPreview} alt="Preview" className="w-full max-h-64 object-contain rounded-2xl border-2 border-purple-200" />
                  <button
                    onClick={() => { setPhotoFile(null); setPhotoPreview(null); }}
                    className="absolute top-2 right-2 w-8 h-8 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              <div className="mt-6 p-4 bg-blue-50 rounded-xl">
                <p className="text-sm text-blue-700 font-medium mb-1">💡 Tips for best results:</p>
                <ul className="text-sm text-blue-600 space-y-1">
                  <li>• Clear, well-lit front-facing photo</li>
                  <li>• Child should be the main subject</li>
                  <li>• Avoid heavy filters or blurry photos</li>
                </ul>
              </div>

              <Button
                onClick={() => setStep("details")}
                disabled={!photoPreview}
                className="w-full mt-6 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 text-white font-bold py-4 rounded-2xl text-lg"
              >
                Continue
                <ChevronRight className="ml-2 w-5 h-5" />
              </Button>
            </div>
          )}

          {/* Step 2: Details */}
          {step === "details" && (
            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2" style={{ fontFamily: "'Fredoka', sans-serif" }}>
                Tell Us About Your Child
              </h2>
              <p className="text-slate-600 mb-6">This helps us personalize the story just for them</p>

              <div className="space-y-5">
                <div>
                  <Label htmlFor="childName" className="text-slate-700 font-semibold mb-2 block">
                    Child's Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="childName"
                    value={childName}
                    onChange={(e) => setChildName(e.target.value)}
                    placeholder="e.g. Emma"
                    className="rounded-xl border-purple-200 focus:border-purple-500 py-3 text-lg"
                  />
                </div>
                <div>
                  <Label htmlFor="childAge" className="text-slate-700 font-semibold mb-2 block">
                    Child's Age
                  </Label>
                  <Input
                    id="childAge"
                    value={childAge}
                    onChange={(e) => setChildAge(e.target.value)}
                    placeholder="e.g. 5"
                    type="number"
                    min="1"
                    max="12"
                    className="rounded-xl border-purple-200 focus:border-purple-500 py-3 text-lg"
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-8">
                <Button
                  variant="outline"
                  onClick={() => setStep("photo")}
                  className="flex-1 border-purple-200 text-purple-700 hover:bg-purple-50 py-4 rounded-2xl"
                >
                  <ChevronLeft className="mr-2 w-4 h-4" />
                  Back
                </Button>
                <Button
                  onClick={() => setStep("theme")}
                  disabled={!childName.trim()}
                  className="flex-1 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 text-white font-bold py-4 rounded-2xl"
                >
                  Continue
                  <ChevronRight className="ml-2 w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Theme */}
          {step === "theme" && (
            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2" style={{ fontFamily: "'Fredoka', sans-serif" }}>
                Choose a Story Theme
              </h2>
              <p className="text-slate-600 mb-6">What kind of adventure should {childName || "your child"} go on?</p>

              <div className="grid grid-cols-2 gap-3">
                {THEME_OPTIONS.map((theme) => (
                  <button
                    key={theme.id}
                    onClick={() => setSelectedTheme(theme.id)}
                    className={`p-4 rounded-2xl border-2 text-left transition-all hover:scale-105 ${
                      selectedTheme === theme.id
                        ? `border-purple-500 bg-purple-50 shadow-md`
                        : `border-slate-200 hover:border-purple-300 ${theme.bg}`
                    }`}
                  >
                    <div className="text-3xl mb-2">{theme.icon}</div>
                    <div className="font-bold text-slate-900 text-sm">{theme.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{theme.description}</div>
                  </button>
                ))}
              </div>

              <div className="flex gap-3 mt-8">
                <Button
                  variant="outline"
                  onClick={() => setStep("details")}
                  className="flex-1 border-purple-200 text-purple-700 hover:bg-purple-50 py-4 rounded-2xl"
                >
                  <ChevronLeft className="mr-2 w-4 h-4" />
                  Back
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!selectedTheme || createOrder.isPending || uploadImage.isPending}
                  className="flex-1 bg-gradient-to-r from-purple-600 via-pink-500 to-orange-400 hover:from-purple-700 hover:via-pink-600 hover:to-orange-500 text-white font-bold py-4 rounded-2xl"
                >
                  {createOrder.isPending || uploadImage.isPending ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Wand2 className="mr-2 w-5 h-5" />
                      Create My Storybook!
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Generating */}
          {step === "generating" && (
            <div className="text-center py-8">
              <div className="relative w-24 h-24 mx-auto mb-6">
                <div className="w-24 h-24 rounded-full border-4 border-purple-200 border-t-purple-600 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Wand2 className="w-10 h-10 text-purple-600" />
                </div>
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-3" style={{ fontFamily: "'Fredoka', sans-serif" }}>
                Creating the Magic! ✨
              </h2>
              <p className="text-slate-600 mb-4">
                We're uploading your photo and setting up your personalized storybook...
              </p>
              <div className="flex items-center justify-center gap-2 text-sm text-purple-600">
                <Sparkles className="w-4 h-4" />
                This usually takes about 30 seconds
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
