import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { LOGO_URL, getLoginUrl } from "@/const";
import { Link } from "wouter";

interface NavBarProps {
  transparent?: boolean;
}

export default function NavBar({ transparent = false }: NavBarProps) {
  const { user, isAuthenticated, logout } = useAuth();

  return (
    <nav
      className={`sticky top-0 z-50 border-b border-purple-100 shadow-sm ${
        transparent ? "bg-white/90 backdrop-blur-md" : "bg-white"
      }`}
    >
      <div className="container flex items-center justify-between h-16">
        <Link href="/">
          <div className="flex items-center gap-2 cursor-pointer">
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
            href="/#gallery"
            className="text-slate-600 hover:text-purple-600 text-sm font-medium hidden md:block transition-colors"
          >
            Gallery
          </a>
          <a
            href="/#how-it-works"
            className="text-slate-600 hover:text-purple-600 text-sm font-medium hidden md:block transition-colors"
          >
            How It Works
          </a>
          <a
            href="/#pricing"
            className="text-slate-600 hover:text-purple-600 text-sm font-medium hidden md:block transition-colors"
          >
            Pricing
          </a>

          {isAuthenticated ? (
            <div className="flex items-center gap-3">
              {user?.role === "admin" && (
                <Link href="/admin">
                  <Button variant="ghost" size="sm" className="text-slate-600 hover:text-purple-600">
                    Admin
                  </Button>
                </Link>
              )}
              <Link href="/dashboard">
                <Button variant="outline" size="sm" className="border-purple-200 text-purple-700 hover:bg-purple-50">
                  Dashboard
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
              <Link href="/my-orders">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-purple-200 text-purple-700 hover:bg-purple-50 hidden sm:inline-flex"
                >
                  My Orders
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
          )}
        </div>
      </div>
    </nav>
  );
}
