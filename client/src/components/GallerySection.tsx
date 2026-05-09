import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { ArrowRight, Sparkles } from "lucide-react";

interface GalleryItem {
  id: number;
  name: string;
  age: number;
  theme: string;
  themeColor: string;
  themeGradient: string;
  imageUrl: string;
  quote: string;
}

const galleryItems: GalleryItem[] = [
  {
    id: 1,
    name: "Mia",
    age: 6,
    theme: "Adventure",
    themeColor: "text-emerald-600",
    themeGradient: "from-emerald-500 to-teal-600",
    imageUrl:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/gallery-pixar-girl-1-Krcbaz34MXwsdgtEXEo6vS.webp",
    quote: "Ready for her next big adventure!",
  },
  {
    id: 2,
    name: "Oliver",
    age: 7,
    theme: "Space",
    themeColor: "text-blue-600",
    themeGradient: "from-blue-500 to-indigo-600",
    imageUrl:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/gallery-pixar-boy-1-4jEv8eRVJH3VKjJYSDxVZW.webp",
    quote: "Exploring the galaxy, one star at a time!",
  },
  {
    id: 3,
    name: "Lily",
    age: 5,
    theme: "Fairy Tale",
    themeColor: "text-purple-600",
    themeGradient: "from-purple-500 to-pink-500",
    imageUrl:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/gallery-pixar-girl-2-GGHptumV3wBWQS4L3egThA.webp",
    quote: "A fairy princess with a heart of gold!",
  },
  {
    id: 4,
    name: "Jack",
    age: 8,
    theme: "Pirate",
    themeColor: "text-amber-600",
    themeGradient: "from-amber-500 to-orange-600",
    imageUrl:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/gallery-pixar-boy-2-gxtfVSdTS7ZX2NZSKEGMX6.webp",
    quote: "Captain Jack and his treasure map!",
  },
  {
    id: 5,
    name: "Emma",
    age: 6,
    theme: "Underwater",
    themeColor: "text-cyan-600",
    themeGradient: "from-cyan-500 to-blue-500",
    imageUrl:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/gallery-pixar-girl-3-Fg4TtM7ES4FkdGSK2SutTC.webp",
    quote: "Diving deep into ocean wonders!",
  },
  {
    id: 6,
    name: "Marcus",
    age: 6,
    theme: "Dinosaur",
    themeColor: "text-green-600",
    themeGradient: "from-green-500 to-lime-600",
    imageUrl:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/gallery-pixar-boy-3-n7imHByPfo7UVxFaVhqbWK.webp",
    quote: "On a prehistoric safari with his dino pal!",
  },
];

export default function GallerySection() {
  const { isAuthenticated } = useAuth();
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  return (
    <section id="gallery" className="py-20 bg-gradient-to-b from-white via-purple-50/30 to-white overflow-hidden">
      <div className="container">
        {/* Section header */}
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-purple-100 text-purple-700 rounded-full text-sm font-medium mb-6">
            <Sparkles className="w-4 h-4" />
            Sample Transformations
          </div>
          <h2 className="text-4xl md:text-5xl font-bold text-slate-900 mb-4">
            See the{" "}
            <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Magic
            </span>{" "}
            in Action
          </h2>
          <p className="text-xl text-slate-600 max-w-2xl mx-auto">
            Every child becomes the hero of their own Pixar-style story. Here are some of our favorite transformations.
          </p>
        </div>

        {/* Gallery grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6 max-w-6xl mx-auto">
          {galleryItems.map((item) => (
            <div
              key={item.id}
              className="group relative rounded-2xl overflow-hidden shadow-md hover:shadow-2xl transition-all duration-500 cursor-pointer"
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {/* Image */}
              <div className="aspect-[3/4] overflow-hidden">
                <img
                  src={item.imageUrl}
                  alt={`${item.name}'s Pixar transformation - ${item.theme} theme`}
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                  loading="lazy"
                />
              </div>

              {/* Gradient overlay */}
              <div
                className={`absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent transition-opacity duration-300 ${
                  hoveredId === item.id ? "opacity-100" : "opacity-70"
                }`}
              />

              {/* Theme badge */}
              <div className="absolute top-3 left-3 md:top-4 md:left-4">
                <span
                  className={`inline-block px-2.5 py-1 md:px-3 md:py-1 rounded-full text-white text-xs font-semibold bg-gradient-to-r ${item.themeGradient} shadow-lg`}
                >
                  {item.theme}
                </span>
              </div>

              {/* Content overlay */}
              <div className="absolute bottom-0 left-0 right-0 p-4 md:p-5">
                <div
                  className={`transition-all duration-500 ${
                    hoveredId === item.id
                      ? "translate-y-0 opacity-100"
                      : "translate-y-2 opacity-80"
                  }`}
                >
                  <h3 className="text-white font-bold text-base md:text-lg">
                    {item.name}, age {item.age}
                  </h3>
                  <p
                    className={`text-white/80 text-xs md:text-sm mt-1 transition-all duration-500 ${
                      hoveredId === item.id
                        ? "max-h-20 opacity-100"
                        : "max-h-0 opacity-0 md:max-h-20 md:opacity-100"
                    } overflow-hidden`}
                  >
                    {item.quote}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="text-center mt-12">
          <p className="text-slate-500 mb-5 text-sm md:text-base">
            Your child could be next! Each transformation is unique and personalized.
          </p>
          {isAuthenticated ? (
            <Link href="/upload">
              <Button
                size="lg"
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-lg px-8 py-6 shadow-lg hover:shadow-xl transition-all"
              >
                Create Your Child's Character
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
          ) : (
            <a href={getLoginUrl()}>
              <Button
                size="lg"
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-lg px-8 py-6 shadow-lg hover:shadow-xl transition-all"
              >
                Create Your Child's Character
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
