import { Component, useCallback, useEffect, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AppProvider, useApp } from './state/AppContext';
import { DEMO_MACHINE_ID } from './ml/data/machines';
import { Layout } from './components/Layout';
import { Copilot } from './components/Copilot';
import { DemoBar } from './components/DemoBar';
import { Toasts } from './components/Toasts';
import { navigate, useRoute } from './lib/router';
import type { Route } from './lib/router';
import { Overview } from './pages/Overview';
import { MachinePage } from './pages/MachinePage';
import { AlertsPage } from './pages/AlertsPage';
import { MaintenancePage } from './pages/MaintenancePage';
import { WhatIfPage } from './pages/WhatIfPage';
import { ComparePage } from './pages/ComparePage';
import { ModelPage } from './pages/ModelPage';
import { HowItWorks } from './pages/HowItWorks';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ForgeGuard] UI error', error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="boot-screen" role="alert">
        <strong>Something went wrong</strong>
        <span>{this.state.error.message}</span>
        <button className="button button-primary" onClick={() => { this.setState({ error: null }); window.location.hash = '#/'; }}>Back to overview</button>
      </div>
    );
  }
}

function Page({ route }: { route: Route }) {
  switch (route.page) {
    case 'machine':
      return <MachinePage id={route.id} />;
    case 'alerts':
      return <AlertsPage />;
    case 'maintenance':
      return <MaintenancePage />;
    case 'whatif':
      return <WhatIfPage id={route.id} />;
    case 'compare':
      return <ComparePage />;
    case 'model':
      return <ModelPage />;
    case 'how':
      return <HowItWorks />;
    default:
      return <Overview />;
  }
}

function Shell() {
  const route = useRoute();
  const { demo } = useApp();
  const [copilot, setCopilot] = useState(false);
  const closeCopilot = useCallback(() => setCopilot(false), []);
  useEffect(() => {
    if (demo.active) navigate({ page: 'machine', id: DEMO_MACHINE_ID });
  }, [demo.active]);
  return (
    <>
      <Layout route={route} onCopilot={() => setCopilot((c) => !c)} banner={<DemoBar />}>
        <ErrorBoundary key={route.page}>
          <Page route={route} />
        </ErrorBoundary>
      </Layout>
      <Copilot open={copilot} onClose={closeCopilot} />
      <Toasts />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <Shell />
      </AppProvider>
    </ErrorBoundary>
  );
}
