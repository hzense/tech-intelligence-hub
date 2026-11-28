import { getDomain } from 'tldts';
import type { SeedSource, TaxonomyTopic } from '@hzense/content';
import { radarTopicLabel } from './radar-topic-labels.ts';
import { compareSourceRows, summarizeSourceReferences } from './source-directory-view.ts';
import { createTopicDomainResolver } from './topic-domain.ts';

type SourceRegistration = Pick<SeedSource, 'id' | 'name' | 'type' | 'active'>;

export interface SourceDirectorySignal {
  id: string;
  title: string;
  date: string;
  topicIds: readonly string[];
  sources: readonly { url: string }[];
}

export interface SourceDirectoryReference {
  id: string;
  title: string;
  date: string;
  domainIds: string[];
  urls: string[];
}

export interface SourceDirectoryRow {
  domain: string;
  registeredHosts: string[];
  domainIds: string[];
  registrations: SourceRegistration[];
  signalCount: number;
  urlCount: number;
  latestDate: string | null;
  references: SourceDirectoryReference[];
}

export interface SourceDirectory {
  rows: SourceDirectoryRow[];
  domains: { key: string; label: string; siteCount: number }[];
  stats: {
    sites: number;
    registeredSources: number;
    citedSites: number;
    unregisteredCitedSites: number;
    signalsWithSources: number;
    signalsWithoutSources: number;
  };
}

function normalizeHost(host: string) {
  return host.toLowerCase().replace(/\.$/, '');
}

function siteDomain(hostname: string) {
  if (/(?:^|\.)(?:localhost|local|internal|lan|home|example|invalid|test|arpa)$/.test(hostname))
    return null;
  return getDomain(hostname, { allowPrivateDomains: true });
}

function sourceArticle(value: string) {
  if (!/^https?:\/\//i.test(value) || /[\s\\\p{Cc}]/u.test(value) || !URL.canParse(value))
    return null;
  const url = new URL(value);
  if (url.username || url.password) return null;
  const domain = siteDomain(normalizeHost(url.hostname));
  if (!domain) return null;

  url.hash = '';
  // Preserve the order and encoding of functional parameters when removing tracking.
  const parameters = url.search.slice(1).split('&');
  url.search = parameters
    .filter((part) => {
      const key = new URLSearchParams(part).keys().next().value ?? '';
      return !/^(?:utm_.*|gclid|fbclid|msclkid)$/i.test(key);
    })
    .join('&');
  return { domain, url: url.href };
}

interface SiteContents {
  registeredHosts: Set<string>;
  registrations: Map<string, SourceRegistration>;
  references: Map<string, Omit<SourceDirectoryReference, 'urls'> & { urls: Set<string> }>;
}

export function buildSourceDirectory(
  registry: readonly (SourceRegistration & { allowed_hosts: readonly string[] })[],
  signals: readonly SourceDirectorySignal[],
  topics: readonly TaxonomyTopic[],
): SourceDirectory {
  const sites = new Map<string, SiteContents>();
  const allSignals = new Set<string>();
  const citedSignals = new Set<string>();
  const resolveDomains = createTopicDomainResolver(topics);
  const domains = [
    ...topics
      .filter((topic) => topic.parentId === null)
      .map(({ id, name }) => ({ key: id, label: radarTopicLabel(id, name), siteCount: 0 })),
    { key: 'unclassified', label: '待归类', siteCount: 0 },
    { key: 'uncited', label: '无引用', siteCount: 0 },
  ];

  function siteFor(domain: string): SiteContents {
    let site = sites.get(domain);
    if (!site) {
      site = { registeredHosts: new Set(), registrations: new Map(), references: new Map() };
      sites.set(domain, site);
    }
    return site;
  }

  // Registry entries describe a site. They do not assign its articles to a publisher.
  for (const { allowed_hosts, id, name, type, active } of registry) {
    for (const allowedHost of allowed_hosts) {
      const host = normalizeHost(allowedHost);
      const domain = siteDomain(host);
      if (!domain) continue;
      const site = siteFor(domain);
      site.registeredHosts.add(host);
      site.registrations.set(id, { id, name, type, active });
    }
  }
  for (const signal of signals) {
    allSignals.add(signal.id);
    const domainIds = resolveDomains(signal.topicIds);
    if (domainIds.length === 0) domainIds.push('unclassified');
    for (const source of signal.sources) {
      const article = sourceArticle(source.url);
      if (!article) continue;
      citedSignals.add(signal.id);
      const site = siteFor(article.domain);
      let reference = site.references.get(signal.id);
      if (!reference) {
        reference = {
          id: signal.id,
          title: signal.title,
          date: signal.date.slice(0, 10),
          domainIds,
          urls: new Set(),
        };
        site.references.set(signal.id, reference);
      }
      reference.urls.add(article.url);
    }
  }

  const rows = Array.from(sites, ([domain, site]) => {
    const registrations = [...site.registrations.values()].sort(
      (a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id),
    );
    const references = [...site.references.values()]
      .map(({ urls, ...signal }) => ({ ...signal, urls: [...urls].sort() }))
      .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    const covered = new Set(references.flatMap((reference) => reference.domainIds));
    if (references.length === 0) covered.add('uncited');
    const domainIds: string[] = [];
    for (const option of domains) {
      if (covered.has(option.key)) {
        domainIds.push(option.key);
        option.siteCount++;
      }
    }
    return {
      domain,
      registeredHosts: [...site.registeredHosts].sort(),
      domainIds,
      registrations,
      ...summarizeSourceReferences(references),
    };
  }).sort(compareSourceRows);
  const citedSites = rows.filter((site) => site.signalCount > 0);
  return {
    rows,
    domains,
    stats: {
      sites: rows.length,
      registeredSources: new Set(registry.map((source) => source.id)).size,
      citedSites: citedSites.length,
      unregisteredCitedSites: citedSites.filter((site) => site.registrations.length === 0).length,
      signalsWithSources: citedSignals.size,
      signalsWithoutSources: allSignals.size - citedSignals.size,
    },
  };
}
