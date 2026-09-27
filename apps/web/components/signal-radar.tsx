import type { SignalRadarModel } from '@/lib/signal-radar-model';
import { SignalRadarExplorer, type RadarExplorerData } from './signal-radar-explorer';

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
    topResources: model.topResources,
    signalIndex: model.signalIndex,
  };
  return <SignalRadarExplorer data={data} />;
}
