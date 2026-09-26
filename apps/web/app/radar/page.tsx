import { permanentRedirect } from 'next/navigation';

/** Preserve the historical route while the current Radar lives at the homepage. */
export default function RadarPage() {
  permanentRedirect('/');
}
