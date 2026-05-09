import { Star } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { Testimonial } from "@/data/testimonials";
import { useState } from "react";

interface TestimonialCardProps {
  testimonial: Testimonial;
}

export default function TestimonialCard({ testimonial }: TestimonialCardProps) {
  const [showAfter, setShowAfter] = useState(false);

  return (
    <Card className="overflow-hidden hover:shadow-lg transition-shadow h-full flex flex-col">
      {/* Before/After Image */}
      <div className="relative aspect-square bg-gradient-to-br from-slate-100 to-slate-200 overflow-hidden group">
        <img
          src={showAfter ? testimonial.afterImage : testimonial.beforeImage}
          alt={showAfter ? "After" : "Before"}
          className="w-full h-full object-cover transition-opacity duration-300"
        />

        {/* Toggle Button */}
        <button
          onClick={() => setShowAfter(!showAfter)}
          className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/20 transition-colors"
        >
          <div className="bg-white/90 hover:bg-white px-4 py-2 rounded-full font-medium text-sm text-slate-800 transition-all">
            {showAfter ? "See Before" : "See After"}
          </div>
        </button>

        {/* Label */}
        <div className="absolute top-3 right-3 bg-blue-600 text-white px-3 py-1 rounded-full text-xs font-semibold">
          {showAfter ? "After" : "Before"}
        </div>
      </div>

      {/* Content */}
      <div className="p-6 flex flex-col flex-grow">
        {/* Stars */}
        <div className="flex gap-1 mb-3">
          {Array.from({ length: testimonial.rating }).map((_, i) => (
            <Star
              key={i}
              className="w-4 h-4 fill-yellow-400 text-yellow-400"
            />
          ))}
        </div>

        {/* Review Text */}
        <p className="text-slate-700 mb-4 flex-grow italic">
          "{testimonial.content}"
        </p>

        {/* Author Info */}
        <div className="border-t pt-4">
          <p className="font-semibold text-slate-800">{testimonial.name}</p>
          <p className="text-sm text-slate-600">{testimonial.role}</p>
          <p className="text-xs text-blue-600 font-medium mt-1">
            Child: {testimonial.childName}
          </p>
        </div>
      </div>
    </Card>
  );
}
