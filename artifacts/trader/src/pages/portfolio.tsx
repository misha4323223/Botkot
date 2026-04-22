import { useGetPortfolio, useListAccounts, useGetPortfolioSummary } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";

interface PaperPos { figi: string; ticker: string; quantity: number; averagePrice: number; currentPrice: number; currentValue: number; unrealizedPnl: number; unrealizedPnlPercent: number; trades: number; }
interface PaperData { positions: PaperPos[]; totalValue: number; totalPnl: number; paperMode: boolean; }

const fmtRub = (n: number) => `₽${n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export default function PortfolioPage() {
  const [selectedAccount, setSelectedAccount] = useState<string>("all");
  const [paper, setPaper] = useState<PaperData | null>(null);

  const { data: accounts } = useListAccounts();
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
    <div className="space-y-4 max-w-7xl mx-auto w-full pb-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Портфель</h1>
        <Select value={selectedAccount} onValueChange={setSelectedAccount}>
          <SelectTrigger className="w-full sm:w-[250px] bg-card border-card-border">
            <SelectValue placeholder="Выберите счёт" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все счета</SelectItem>
            {accounts?.map((acc) => (
              <SelectItem key={acc.id} value={acc.id}>
                {acc.name} ({acc.id.slice(-4)})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary — 1 col mobile, 3 col desktop */}
      <Card className="bg-card border-card-border p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Стоимость портфеля</p>
          {summary ? (
            <p className="text-xl sm:text-3xl font-bold font-mono break-all">{fmtRub(summary.totalValue)}</p>
          ) : <Skeleton className="h-8 w-32" />}
        </div>
        <div>
          <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Общий P&L</p>
          {summary ? (
            <p className={`text-lg sm:text-2xl font-bold font-mono break-all ${summary.totalPnl >= 0 ? "text-success" : "text-destructive"}`}>
              {summary.totalPnl >= 0 ? "+" : ""}{fmtRub(summary.totalPnl)}
              <span className="text-xs sm:text-sm ml-2 whitespace-nowrap">({fmtPct(summary.totalPnlPercent)})</span>
            </p>
          ) : <Skeleton className="h-8 w-32" />}
        </div>
        <div>
          <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Свободные средства</p>
          {summary ? (
            <p className="text-lg sm:text-2xl font-bold font-mono break-all">{fmtRub(summary.cashRub)}</p>
          ) : <Skeleton className="h-8 w-32" />}
        </div>
      </Card>

      {/* Paper positions */}
      {paper && paper.paperMode && (
        <Card className="bg-card border-card-border p-4 sm:p-6">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">📄 PAPER</Badge>
            <h2 className="text-base sm:text-lg font-semibold">Бумажные позиции (симуляция)</h2>
            <span className="text-xs text-muted-foreground sm:ml-auto w-full sm:w-auto">Реальные деньги не используются</span>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div>
              <p className="text-[11px] sm:text-xs text-muted-foreground">Стоимость</p>
              <p className="text-sm sm:text-xl font-mono font-bold break-all">₽{paper.totalValue.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-[11px] sm:text-xs text-muted-foreground">P&L</p>
              <p className={`text-sm sm:text-xl font-mono font-bold break-all ${paper.totalPnl >= 0 ? "text-success" : "text-destructive"}`}>
                {paper.totalPnl >= 0 ? "+" : ""}₽{paper.totalPnl.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-[11px] sm:text-xs text-muted-foreground">Позиций</p>
              <p className="text-sm sm:text-xl font-mono font-bold">{paper.positions.length}</p>
            </div>
          </div>
          {paper.positions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Агент пока не открыл бумажных позиций.</p>
          ) : (
            <>
              {/* Mobile cards */}
              <div className="space-y-2 sm:hidden">
                {paper.positions.map(p => (
                  <div key={p.figi} className="rounded-md border border-border bg-muted/10 p-3 space-y-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-bold text-sm">{p.ticker}</span>
                      <span className={`font-mono text-sm font-bold ${p.unrealizedPnl >= 0 ? "text-success" : "text-destructive"}`}>
                        {p.unrealizedPnl >= 0 ? "+" : ""}₽{p.unrealizedPnl.toFixed(2)}
                        <span className="text-[11px] ml-1 opacity-80">({fmtPct(p.unrealizedPnlPercent)})</span>
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                      <div>Лотов: <span className="font-mono text-foreground">{p.quantity}</span></div>
                      <div>Стоимость: <span className="font-mono text-foreground">₽{p.currentValue.toFixed(2)}</span></div>
                      <div>Ср. цена: <span className="font-mono text-foreground">₽{p.averagePrice.toFixed(2)}</span></div>
                      <div>Сейчас: <span className="font-mono text-foreground">₽{p.currentPrice.toFixed(2)}</span></div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop table */}
              <div className="overflow-x-auto hidden sm:block">
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
                          <div className="text-xs opacity-80">{fmtPct(p.unrealizedPnlPercent)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      )}

      {/* Real positions */}
      <Card className="bg-card border-card-border overflow-hidden">
        <div className="px-4 sm:px-6 py-3 border-b border-border">
          <h2 className="text-base sm:text-lg font-semibold">Реальные позиции</h2>
        </div>

        {isLoadingPortfolio ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : !portfolio || portfolio.positions.length === 0 ? (
          <p className="px-6 py-12 text-center text-muted-foreground text-sm">На этом счёте нет позиций.</p>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-border">
              {portfolio.positions.map(pos => (
                <div key={pos.figi} className="px-4 py-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm">{pos.ticker}</span>
                        <Badge variant="outline" className="text-[10px] uppercase px-1.5 py-0">{pos.instrumentType}</Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">{pos.name}</div>
                    </div>
                    <div className={`text-right font-mono shrink-0 ${pos.unrealizedPnl >= 0 ? "text-success" : "text-destructive"}`}>
                      <div className="text-sm font-bold">{pos.unrealizedPnl >= 0 ? "+" : ""}₽{pos.unrealizedPnl.toFixed(2)}</div>
                      <div className="text-[11px] opacity-80">{fmtPct(pos.unrealizedPnlPercent)}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                    <div>Кол-во: <span className="font-mono text-foreground">{pos.quantity}</span></div>
                    <div>Стоимость: <span className="font-mono text-foreground">₽{pos.currentValue.toFixed(2)}</span></div>
                    <div>Ср. цена: <span className="font-mono text-foreground">₽{pos.averagePrice.toFixed(2)}</span></div>
                    <div>Сейчас: <span className="font-mono text-foreground">₽{pos.currentPrice.toFixed(2)}</span></div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="overflow-x-auto hidden sm:block">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase text-muted-foreground bg-muted/50 border-b border-border">
                  <tr>
                    <th className="px-6 py-4 font-medium">Бумага</th>
                    <th className="px-6 py-4 font-medium">Тип</th>
                    <th className="px-6 py-4 font-medium text-right">Кол-во</th>
                    <th className="px-6 py-4 font-medium text-right">Ср. цена</th>
                    <th className="px-6 py-4 font-medium text-right">Текущая</th>
                    <th className="px-6 py-4 font-medium text-right">Стоимость</th>
                    <th className="px-6 py-4 font-medium text-right">P&L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {portfolio.positions.map((pos) => (
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
                      <td className="px-6 py-4 text-right font-mono">{fmtRub(pos.currentValue)}</td>
                      <td className={`px-6 py-4 text-right font-mono font-medium ${pos.unrealizedPnl >= 0 ? "text-success" : "text-destructive"}`}>
                        {pos.unrealizedPnl >= 0 ? "+" : ""}₽{pos.unrealizedPnl.toFixed(2)}
                        <div className="text-xs opacity-80">{fmtPct(pos.unrealizedPnlPercent)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
