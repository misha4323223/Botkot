import { useState } from "react";
import { useSearchInstruments, useGetCandles, useAddToWatchlist, useGetWatchlist, getGetWatchlistQueryKey, useGetLastPrice } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Search, Plus, Check } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Bar } from "recharts";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

export default function MarketPage() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedFigi, setSelectedFigi] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const { data: searchResults, isLoading: isSearching } = useSearchInstruments(
    { query: debouncedQuery },
    { query: { enabled: debouncedQuery.length > 2 } }
  );

  const { data: watchlist } = useGetWatchlist();
  const addToWatchlist = useAddToWatchlist({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
      }
    }
  });

  const { data: candles, isLoading: isLoadingCandles } = useGetCandles(selectedFigi || "", { interval: "day" }, {
    query: { enabled: !!selectedFigi }
  });

  const { data: lastPrice } = useGetLastPrice(selectedFigi || "", {
    query: { enabled: !!selectedFigi }
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setDebouncedQuery(query);
  };

  const selectedInstrument = searchResults?.find(r => r.figi === selectedFigi) || null;
  const isWatched = watchlist?.some(w => w.figi === selectedFigi);

  const chartData = candles?.map(c => ({
    time: format(new Date(c.time), "MMM dd"),
    price: c.close,
    volume: c.volume
  })) || [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto h-full flex flex-col">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Market</h1>
      </div>

      <div className="flex gap-6 h-full overflow-hidden">
        {/* Sidebar Search */}
        <Card className="w-80 bg-card border-card-border flex flex-col">
          <div className="p-4 border-b border-border">
            <form onSubmit={handleSearch} className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder="Search stocks, ETFs..." 
                className="pl-9 bg-background border-border"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </form>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {isSearching ? (
              <div className="p-4 space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
            ) : searchResults?.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">No results found</div>
            ) : (
              searchResults?.map((inst) => (
                <button
                  key={inst.figi}
                  className={`w-full text-left p-3 rounded-md transition-colors flex flex-col gap-1 ${
                    selectedFigi === inst.figi ? "bg-primary/10 text-primary" : "hover:bg-muted/50"
                  }`}
                  onClick={() => setSelectedFigi(inst.figi)}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="font-bold text-sm">{inst.ticker}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/80 text-muted-foreground uppercase">{inst.type}</span>
                  </div>
                  <span className="text-xs text-muted-foreground truncate w-full">{inst.name}</span>
                </button>
              ))
            )}
          </div>
        </Card>

        {/* Main Chart Area */}
        <Card className="flex-1 bg-card border-card-border p-6 flex flex-col">
          {selectedInstrument ? (
            <>
              <div className="flex items-start justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-bold">{selectedInstrument.name}</h2>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-muted-foreground font-mono">{selectedInstrument.ticker}</span>
                    <span className="text-muted-foreground">•</span>
                    <span className="text-muted-foreground text-sm uppercase">{selectedInstrument.exchange}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-3">
                  <div className="text-3xl font-bold font-mono">
                    {lastPrice ? `₽${lastPrice.price.toFixed(2)}` : <Skeleton className="h-8 w-24" />}
                  </div>
                  <Button 
                    variant={isWatched ? "secondary" : "default"}
                    size="sm"
                    onClick={() => {
                      if (!isWatched) {
                        addToWatchlist.mutate({
                          data: {
                            figi: selectedInstrument.figi,
                            ticker: selectedInstrument.ticker,
                            name: selectedInstrument.name
                          }
                        });
                      }
                    }}
                    disabled={isWatched || addToWatchlist.isPending}
                  >
                    {isWatched ? <Check className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                    {isWatched ? "In Watchlist" : "Add to Watchlist"}
                  </Button>
                </div>
              </div>

              <div className="flex-1 min-h-[400px] w-full">
                {isLoadingCandles ? (
                  <Skeleton className="w-full h-full" />
                ) : chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis yAxisId="price" domain={['auto', 'auto']} stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `₽${val}`} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '4px' }}
                        itemStyle={{ color: 'hsl(var(--foreground))' }}
                        labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
                      />
                      <Line yAxisId="price" type="monotone" dataKey="price" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "hsl(var(--primary))" }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    No chart data available
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              Select an instrument to view details
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
