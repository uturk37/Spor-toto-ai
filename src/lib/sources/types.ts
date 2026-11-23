import type { ResolvedTeam } from "../data/teams";
import type { H2HMatch, SourcedTeamStats } from "../data/stats";
import type { AbsenceEvidence, ExpertPick, MatchEvidence } from "../model/engines";
import type { Provenance, SourceStatus } from "../types";

export interface MatchContext {
  home: ResolvedTeam;
  away: ResolvedTeam;
  kickoff: Date;
  /** Milli maç (ülke adları) ise true. */
  national: boolean;
}

export interface NewsHit {
  title: string;
  url: string;
  publishedAt: string | null;
  side: "home" | "away";
  kind: "sakatlik" | "kadro" | "genel";
  prov: Provenance;
}

export interface LineupInfo {
  side: "home" | "away";
  formation: string | null;
  startXI: string[];
  official: boolean;
  prov: Provenance;
}

export interface AdapterResult {
  sourceId: string;
  status: SourceStatus;
  url: string;
  error?: string;
  dataAsOf?: string | null;
  evidence?: Partial<Pick<MatchEvidence, "elo" | "sourceModelProbs" | "homeAtHome" | "awayAway" | "leagueAverages" | "odds">>;
  homeStats?: SourcedTeamStats;
  awayStats?: SourcedTeamStats;
  h2h?: { matches: H2HMatch[]; prov: Provenance };
  absences?: AbsenceEvidence[];
  lineups?: LineupInfo[];
  news?: NewsHit[];
  experts?: ExpertPick[];
  /** Sonuç (maç bittiyse) — çapraz kontrol için. */
  finalScore?: { home: number; away: number; prov: Provenance };
  summary?: string;
}

export interface Adapter {
  id: string;
  /** Bu bağlamda uygulanabilir mi (ör. ClubElo milli maçlarda değil). */
  applies(ctx: MatchContext): boolean;
  collect(ctx: MatchContext): Promise<AdapterResult>;
}
