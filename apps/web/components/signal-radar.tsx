import type { SignalRadarModel } from '@/lib/signal-radar-model';
import type { RadarExplorerData } from '@/lib/radar-window';
import { SignalRadarExplorer } from './signal-radar-explorer';

/** Keep the public reader and full Signal records on the server boundary. */
export function SignalRadar({ model }: { model: SignalRadarModel }) {
  const data: RadarExplorerData = {
    asOf: model.asOf,
    recentStart: model.recentStart,
    totalCount: model.totalCount,
    recentCount: model.recentCount,
    previousCount: model.previousCount,
    domains: model.domains.map(
      ({ id, name, totalCount, recentCount, previousCount, signalIds }) => ({
        id,
        name,
        totalCount,
        recentCount,
        previousCount,
        signalIds,
      }),
    ),
    categories: model.categories,
    resources: model.resources,
    signalIndex: model.signalIndex,
  };
  return <SignalRadarExplorer data={data} />;
}
