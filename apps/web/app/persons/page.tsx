import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// Preserve older links while making /resources the one public organization
// and person directory.
export default function PersonsPage() {
  redirect('/resources#people');
}
