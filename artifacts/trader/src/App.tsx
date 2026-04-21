import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { Layout } from "@/components/layout";
import Home from "@/pages/home";
import PortfolioPage from "@/pages/portfolio";
import MarketPage from "@/pages/market";
import AgentPage from "@/pages/agent";
import OrdersPage from "@/pages/orders";
import SettingsPage from "@/pages/settings";
import LoginPage from "@/pages/login";
import { AuthProvider, useAuth } from "@/hooks/use-auth";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/portfolio" component={PortfolioPage} />
        <Route path="/market" component={MarketPage} />
        <Route path="/agent" component={AgentPage} />
        <Route path="/orders" component={OrdersPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function Gate() {
  const { loading, authRequired, authenticated } = useAuth();
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Загрузка...</div>;
  }
  if (authRequired && !authenticated) {
    return <LoginPage />;
  }
  return <Router />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}>
          <AuthProvider>
            <Gate />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
