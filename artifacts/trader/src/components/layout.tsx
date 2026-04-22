import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Briefcase, 
  LineChart, 
  Bot, 
  ListOrdered, 
  Settings,
  Activity
} from "lucide-react";
import { cn } from "@/lib/utils";

const navigation = [
  { name: "Главная", href: "/", icon: LayoutDashboard },
  { name: "Портфель", href: "/portfolio", icon: Briefcase },
  { name: "Рынок", href: "/market", icon: LineChart },
  { name: "Агент", href: "/agent", icon: Bot },
  { name: "Ордера", href: "/orders", icon: ListOrdered },
  { name: "Настройки", href: "/settings", icon: Settings },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="flex h-[100dvh] w-full bg-background text-foreground overflow-hidden">
      {/* Sidebar — desktop only */}
      <div className="hidden lg:flex w-64 border-r border-border bg-card flex-col shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <Activity className="w-6 h-6 text-primary mr-2" />
          <span className="font-bold text-lg tracking-tight text-card-foreground">AI Трейдер</span>
        </div>
        
        <div className="flex-1 overflow-y-auto py-4">
          <nav className="px-3 space-y-1">
            {navigation.map((item) => {
              const isActive = location === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    "flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <item.icon
                    className={cn(
                      "mr-3 flex-shrink-0 h-5 w-5",
                      isActive ? "text-primary" : "text-muted-foreground"
                    )}
                    aria-hidden="true"
                  />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>
        
        <div className="p-4 border-t border-border">
          <div className="flex items-center">
            <div className="w-8 h-8 rounded bg-primary/20 flex items-center justify-center text-primary font-bold text-xs">
              AI
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-card-foreground">Tinkoff Live</p>
              <p className="text-xs text-green-500">Подключено</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center h-14 px-4 border-b border-border bg-card shrink-0">
          <Activity className="w-5 h-5 text-primary mr-2" />
          <span className="font-bold text-base tracking-tight text-card-foreground">AI Трейдер</span>
        </div>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-8 pb-20 lg:pb-8">
          {children}
        </main>

        {/* Bottom nav — mobile only */}
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card">
          <nav className="flex">
            {navigation.map((item) => {
              const isActive = location === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    "flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] font-medium transition-colors min-h-[56px]",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground"
                  )}
                >
                  <item.icon
                    className={cn("h-5 w-5 shrink-0", isActive ? "text-primary" : "text-muted-foreground")}
                    aria-hidden="true"
                  />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </div>
  );
}
