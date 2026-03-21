import { useGetSignalHistory } from "@workspace/api-client-react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { Plus, TrendingUp, AlertTriangle, ShieldCheck, Activity } from "lucide-react";
import { SignalBadge } from "@/components/SignalBadge";

export default function Dashboard() {
  const { data, isLoading, isError } = useGetSignalHistory({ limit: 20 });

  const stats = {
    total: data?.total || 0,
    buys: data?.items.filter(i => i.signal === "Buy").length || 0,
    sells: data?.items.filter(i => i.signal === "Sell").length || 0,
    avgConfidence: data?.items.length 
      ? Math.round(data.items.reduce((acc, curr) => acc + curr.confidenceScore, 0) / data.items.length)
      : 0
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of recent AI signal analysis runs.</p>
        </div>
        <Link 
          href="/analyze"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold bg-primary text-primary-foreground shadow-lg glow-primary hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200"
        >
          <Plus className="w-5 h-5" />
          New Analysis
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: "Total Analyses", value: stats.total, icon: Activity, color: "text-chart-4" },
          { label: "Buy Signals", value: stats.buys, icon: TrendingUp, color: "text-primary" },
          { label: "Sell Signals", value: stats.sells, icon: AlertTriangle, color: "text-destructive" },
          { label: "Avg Confidence", value: `${stats.avgConfidence}%`, icon: ShieldCheck, color: "text-chart-2" },
        ].map((stat, i) => (
          <motion.div 
            key={i}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.1 }}
            className="glass-panel p-6 rounded-2xl flex flex-col gap-4 relative overflow-hidden group"
          >
            <div className="absolute -right-6 -top-6 opacity-5 group-hover:opacity-10 transition-opacity">
              <stat.icon className="w-32 h-32" />
            </div>
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-muted border border-border">
                <stat.icon className={`w-5 h-5 ${stat.color}`} />
              </div>
              <p className="text-muted-foreground font-medium">{stat.label}</p>
            </div>
            <p className="text-4xl font-bold font-mono tracking-tight">{stat.value}</p>
          </motion.div>
        ))}
      </div>

      <div className="glass-panel rounded-2xl overflow-hidden border border-border/50">
        <div className="p-6 border-b border-border/50 flex items-center justify-between bg-card/40">
          <h2 className="text-xl font-bold">Recent Signals</h2>
        </div>
        
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground animate-pulse flex flex-col items-center">
            <Activity className="w-8 h-8 mb-4 opacity-50" />
            <p>Loading signal history...</p>
          </div>
        ) : isError ? (
          <div className="p-12 text-center text-destructive flex flex-col items-center">
            <AlertTriangle className="w-8 h-8 mb-4 opacity-50" />
            <p>Failed to load signal history.</p>
          </div>
        ) : !data?.items || data.items.length === 0 ? (
          <div className="p-16 text-center flex flex-col items-center justify-center">
            <div className="p-4 rounded-full bg-muted border border-border mb-4">
              <Activity className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-bold mb-2">No signals yet</h3>
            <p className="text-muted-foreground max-w-sm">Run your first setup analysis to see it appear in your history.</p>
            <Link 
              href="/analyze"
              className="mt-6 px-6 py-2 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors font-medium"
            >
              Run Analysis
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border/50 bg-muted/20 text-muted-foreground text-sm uppercase tracking-wider">
                  <th className="p-4 font-medium">Symbol</th>
                  <th className="p-4 font-medium">Signal</th>
                  <th className="p-4 font-medium text-right">Confidence</th>
                  <th className="p-4 font-medium text-right">Risk</th>
                  <th className="p-4 font-medium">Regime</th>
                  <th className="p-4 font-medium text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {data.items.map((item, i) => (
                  <tr key={item.id} className="hover:bg-muted/30 transition-colors group">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-lg tracking-tight">{item.symbol}</span>
                        <span className="text-xs px-2 py-1 rounded-md bg-muted text-muted-foreground border border-border">
                          {item.timeframe}
                        </span>
                      </div>
                    </td>
                    <td className="p-4">
                      <SignalBadge signal={item.signal} />
                    </td>
                    <td className="p-4 text-right">
                      <span className="font-mono text-lg font-semibold">{item.confidenceScore}%</span>
                    </td>
                    <td className="p-4 text-right">
                      <span className="font-mono text-lg font-semibold text-muted-foreground">{item.riskScore}%</span>
                    </td>
                    <td className="p-4">
                      <span className="capitalize text-sm font-medium text-muted-foreground tracking-wide">
                        {item.marketRegime}
                      </span>
                    </td>
                    <td className="p-4 text-right text-muted-foreground text-sm">
                      {format(new Date(item.createdAt), "MMM dd, HH:mm")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
}
