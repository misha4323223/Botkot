import { useGetPortfolio, useListAccounts, useGetPortfolioSummary } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";

interface PaperPos { figi: string; ticker: string; quantity: number; averagePrice: number; currentPrice: number; currentValue: number; unrealizedPnl: number; unrealizedPnlPercent: number; trades: number; }
interface PaperData { positions: PaperPos[]; totalValue: number; totalPnl: number; paperMode: boolean; }

export default function PortfolioPage() {
  const [selectedAccount, setSelectedAccount] = useState<string>("all");
  const [paper, setPaper] = useState<PaperData | null>(null);

  const { data: accounts, isLoading: isLoadingAccounts } = useListAccounts();
  const { data: portfolio, isLoading: isLoadingPortfolio } = useGetPortfolio();
  const { data: summary } = useGetPortfolioSummary();

  useEffect(() => {
    const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
    const load = () => fetch(`${base}/api/portfolio/paper`).then(r => r.ok ? r.json() : null).then(setPaper).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto h-full flex flex-col">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Portfolio</h1>
        
        <div className="flex items-center space-x-4">
          <Select value={selectedAccount} onValueChange={setSelectedAccount}>
            <SelectTrigger className="w-[250px] bg-card border-card-border">
              <SelectValue placeholder="Select Account" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Accounts</SelectItem>
              {accounts?.map((acc) => (
                <SelectItem key={acc.id} value={acc.id}>
                  {acc.name} ({acc.id.slice(-4)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="bg-card border-card-border p-6 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground mb-1">Total Value</p>
          {summary ? (
            <p className="text-3xl font-bold font-mono">₽{summary.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          ) : <Skeleton className="h-8 w-32" />}
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground mb-1">Total P&L</p>
          {summary ? (
            <p className={`text-2xl font-bold font-mono ${summary.totalPnl >= 0 ? "text-success" : "text-destructive"}`}>
              {summary.totalPnl >= 0 ? "+" : ""}₽{summary.totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-sm ml-2">({summary.totalPnl >= 0 ? "+" : ""}{summary.totalPnlPercent.toFixed(2)}%)</span>
            </p>
          ) : <Skeleton className="h-8 w-32" />}
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground mb-1">Cash Balance</p>
          {summary ? (
            <p className="text-2xl font-bold font-mono">₽{summary.cashRub.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          ) : <Skeleton className="h-8 w-32" />}
        </div>
      </Card>

      {paper && paper.paperMode && (
        <Card className="bg-card border-card-border p-6">
          <div className="flex items-center gap-2 mb-4">
            <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">📄 PAPER</Badge>
            <h2 className="text-lg font-semibold">Бумажные позиции (симуляция агента)</h2>
            <span className="text-xs text-muted-foreground ml-auto">Реальные деньги не используются</span>
          </div>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <p className="text-xs text-muted-foreground">Стоимость портфеля</p>
              <p className="text-xl font-mono font-bold">₽{paper.totalValue.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Нереализованный P&L</p>
              <p className={`text-xl font-mono font-bold ${paper.totalPnl >= 0 ? "text-success" : "text-destructive"}`}>
                {paper.totalPnl >= 0 ? "+" : ""}₽{paper.totalPnl.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Открытых позиций</p>
              <p className="text-xl font-mono font-bold">{paper.positions.length}</p>
            </div>
          </div>
          {paper.positions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Агент пока не открыл бумажных позиций.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground border-b border-border">
                  <tr>
                    <th className="px-3 py-2 text-left">Тикер</th>
                    <th className="px-3 py-2 text-right">Лотов</th>
                    <th className="px-3 py-2 text-right">Ср. цена</th>
                    <th className="px-3 py-2 text-right">Сейчас</th>
                    <th className="px-3 py-2 text-right">Стоимость</th>
                    <th className="px-3 py-2 text-right">P&L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paper.positions.map(p => (
                    <tr key={p.figi}>
                      <td className="px-3 py-2 font-bold">{p.ticker}</td>
                      <td className="px-3 py-2 text-right font-mono">{p.quantity}</td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">₽{p.averagePrice.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono">₽{p.currentPrice.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono">₽{p.currentValue.toFixed(2)}</td>
                      <td className={`px-3 py-2 text-right font-mono ${p.unrealizedPnl >= 0 ? "text-success" : "text-destructive"}`}>
                        {p.unrealizedPnl >= 0 ? "+" : ""}₽{p.unrealizedPnl.toFixed(2)}
                        <div className="text-xs opacity-80">{p.unrealizedPnl >= 0 ? "+" : ""}{p.unrealizedPnlPercent.toFixed(2)}%</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card className="bg-card border-card-border flex-1 flex flex-col overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs uppercase text-muted-foreground bg-muted/50 border-b border-border sticky top-0">
              <tr>
                <th className="px-6 py-4 font-medium">Asset</th>
                <th className="px-6 py-4 font-medium">Type</th>
                <th className="px-6 py-4 font-medium text-right">Quantity</th>
                <th className="px-6 py-4 font-medium text-right">Avg Price</th>
                <th className="px-6 py-4 font-medium text-right">Current Price</th>
                <th className="px-6 py-4 font-medium text-right">Value</th>
                <th className="px-6 py-4 font-medium text-right">P&L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoadingPortfolio ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="px-6 py-4"><Skeleton className="h-6 w-full" /></td>
                  </tr>
                ))
              ) : portfolio?.positions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-muted-foreground">
                    No positions found in this account.
                  </td>
                </tr>
              ) : (
                portfolio?.positions.map((pos) => (
                  <tr key={pos.figi} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-bold text-card-foreground">{pos.ticker}</div>
                      <div className="text-xs text-muted-foreground">{pos.name}</div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant="outline" className="text-xs uppercase">{pos.instrumentType}</Badge>
                    </td>
                    <td className="px-6 py-4 text-right font-mono">{pos.quantity}</td>
                    <td className="px-6 py-4 text-right font-mono text-muted-foreground">₽{pos.averagePrice.toFixed(2)}</td>
                    <td className="px-6 py-4 text-right font-mono font-medium">₽{pos.currentPrice.toFixed(2)}</td>
                    <td className="px-6 py-4 text-right font-mono">₽{pos.currentValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className={`px-6 py-4 text-right font-mono font-medium ${pos.unrealizedPnl >= 0 ? "text-success" : "text-destructive"}`}>
                      {pos.unrealizedPnl >= 0 ? "+" : ""}₽{pos.unrealizedPnl.toFixed(2)}
                      <div className="text-xs opacity-80">
                        {pos.unrealizedPnl >= 0 ? "+" : ""}{pos.unrealizedPnlPercent.toFixed(2)}%
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
