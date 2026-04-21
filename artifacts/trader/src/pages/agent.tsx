import { useState, useEffect, useRef } from "react";
import { 
  useGetAgentStatus, 
  useStartAgent, 
  useStopAgent, 
  useGetWatchlist, 
  useRemoveFromWatchlist,
  getGetAgentStatusQueryKey,
  getGetWatchlistQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, Play, Square, Trash2, TerminalSquare } from "lucide-react";

export default function AgentPage() {
  const queryClient = useQueryClient();
  const [streamData, setStreamData] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  
  const { data: status, isLoading: isStatusLoading } = useGetAgentStatus();
  const { data: watchlist, isLoading: isWatchlistLoading } = useGetWatchlist();

  const startAgent = useStartAgent({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetAgentStatusQueryKey() }) }
  });
  const stopAgent = useStopAgent({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetAgentStatusQueryKey() }) }
  });
  const removeWatchlist = useRemoveFromWatchlist({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() }) }
  });

  const handleManualAnalyze = async (figi?: string) => {
    setIsStreaming(true);
    setStreamData("");
    try {
      const response = await fetch("/api/agent/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ figi: figi || null, executeIfConfident: true })
      });
      
      if (!response.body) throw new Error("No response body");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        setStreamData(prev => prev + text);
        if (streamRef.current) {
          streamRef.current.scrollTop = streamRef.current.scrollHeight;
        }
      }
    } catch (error) {
      setStreamData(prev => prev + "\n[ERROR] Stream interrupted.");
    } finally {
      setIsStreaming(false);
      queryClient.invalidateQueries({ queryKey: getGetAgentStatusQueryKey() });
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI Agent Control</h1>
          <p className="text-muted-foreground mt-1">Manage autonomous trading and watchlist</p>
        </div>
        <div className="flex items-center gap-4">
          {status && (
            <Badge variant="outline" className={`px-3 py-1 ${status.isRunning ? "border-success text-success" : "border-muted-foreground text-muted-foreground"}`}>
              {status.isRunning ? "Active" : "Paused"}
            </Badge>
          )}
          {status?.isRunning ? (
            <Button variant="destructive" onClick={() => stopAgent.mutate({})} disabled={stopAgent.isPending}>
              <Square className="w-4 h-4 mr-2 fill-current" /> Stop Agent
            </Button>
          ) : (
            <Button className="bg-success hover:bg-success/90 text-success-foreground" onClick={() => startAgent.mutate({})} disabled={startAgent.isPending || isStatusLoading}>
              <Play className="w-4 h-4 mr-2 fill-current" /> Start Agent
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        
        {/* Watchlist */}
        <Card className="bg-card border-card-border flex flex-col col-span-1">
          <CardHeader className="border-b border-border pb-4">
            <CardTitle>Agent Watchlist</CardTitle>
            <CardDescription>Assets the AI actively monitors</CardDescription>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-y-auto">
            {isWatchlistLoading ? (
              <div className="p-4 space-y-4"><Skeleton className="h-12 w-full"/><Skeleton className="h-12 w-full"/></div>
            ) : watchlist?.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">Watchlist is empty. Add assets from the Market page.</div>
            ) : (
              <div className="divide-y divide-border">
                {watchlist?.map((item) => (
                  <div key={item.id} className="p-4 flex items-center justify-between hover:bg-muted/30">
                    <div>
                      <p className="font-bold font-mono text-sm">{item.ticker}</p>
                      <p className="text-xs text-muted-foreground truncate w-[150px]">{item.name}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => handleManualAnalyze(item.figi)} disabled={isStreaming}>
                        Analyze
                      </Button>
                      <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => removeWatchlist.mutate({ id: item.id })}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
          <div className="p-4 border-t border-border bg-muted/20">
            <Button variant="default" className="w-full" onClick={() => handleManualAnalyze()} disabled={isStreaming || watchlist?.length === 0}>
              <Bot className="w-4 h-4 mr-2" /> Analyze Entire Watchlist
            </Button>
          </div>
        </Card>

        {/* Live Analysis Stream */}
        <Card className="bg-[#0a0a0a] border-card-border flex flex-col col-span-2 shadow-inner">
          <CardHeader className="border-b border-border/50 pb-3 flex flex-row items-center justify-between">
            <div className="flex items-center text-primary">
              <TerminalSquare className="w-5 h-5 mr-2" />
              <CardTitle className="text-sm font-mono tracking-widest uppercase">Live Thought Stream</CardTitle>
            </div>
            {isStreaming && <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />}
          </CardHeader>
          <CardContent className="p-0 flex-1 relative">
            <div 
              ref={streamRef}
              className="absolute inset-0 overflow-y-auto p-4 font-mono text-sm text-[#00ff9d] whitespace-pre-wrap leading-relaxed"
              style={{ textShadow: "0 0 5px rgba(0,255,157,0.3)" }}
            >
              {streamData ? streamData : (
                <div className="text-muted-foreground/50 italic h-full flex items-center justify-center">
                  Waiting for analysis trigger...
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
