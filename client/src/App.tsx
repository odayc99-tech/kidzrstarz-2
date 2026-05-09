import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Upload from "./pages/Upload";
import Checkout from "./pages/Checkout";
import Dashboard from "./pages/Dashboard";
import Storybook from "./pages/Storybook";
import SharedStorybook from "./pages/SharedStorybook";
import GuestOrders from "./pages/GuestOrders";
import MarketingStrategy from "./pages/MarketingStrategy";
import Admin from "./pages/Admin";
import AdminLogin from "./pages/AdminLogin";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/upload"} component={Upload} />
      <Route path={"/checkout"} component={Checkout} />
      <Route path={"/dashboard"} component={Dashboard} />
      <Route path={"/storybook"} component={Storybook} />
      <Route path={"/my-orders"} component={GuestOrders} />
      <Route path={"/marketing-strategy"} component={MarketingStrategy} />
      <Route path={"/admin"} component={Admin} />
      <Route path={"/admin-login"} component={AdminLogin} />
      <Route path={"/share/:token"} component={SharedStorybook} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
