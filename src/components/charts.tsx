"use client";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const axis = { stroke: "#64748b", fontSize: 12 };
const tooltip = { contentStyle: { background: "#0a1020", border: "1px solid #22335a", borderRadius: 8 }, labelStyle: { color: "#e2e8f0" } };

export function SuccessChart({ data }: { data: Array<{ hafta: string; ai: number | null; kupon: number | null; uzman: number | null }> }) {
  return (
    <div className="h-56">
      <ResponsiveContainer>
        <LineChart data={data}>
          <CartesianGrid stroke="#16223f" />
          <XAxis dataKey="hafta" {...axis} />
          <YAxis domain={[0, 100]} unit="%" {...axis} />
          <Tooltip {...tooltip} formatter={(v) => `%${v}`} />
          <Legend />
          <Line type="monotone" dataKey="ai" name="AI ana tahmin" stroke="#22c55e" strokeWidth={2} connectNulls />
          <Line type="monotone" dataKey="kupon" name="AI önerilen işaret" stroke="#facc15" strokeWidth={2} connectNulls />
          <Line type="monotone" dataKey="uzman" name="Uzman ortak görüşü" stroke="#38bdf8" strokeWidth={2} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function EngineChart({ data }: { data: Array<{ motor: string; "1": number; X: number; "2": number }> }) {
  return (
    <div className="h-56">
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid stroke="#16223f" />
          <XAxis dataKey="motor" {...axis} />
          <YAxis domain={[0, 100]} unit="%" {...axis} />
          <Tooltip {...tooltip} formatter={(v) => `%${v}`} />
          <Legend />
          <Bar dataKey="1" fill="#22c55e" />
          <Bar dataKey="X" fill="#facc15" />
          <Bar dataKey="2" fill="#38bdf8" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
