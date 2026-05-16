import { ActionsDueWidget } from '@/components/crm/ActionsDueWidget';
import { ForecastWidget } from '@/components/crm/ForecastWidget';
import { WipWidget } from '@/components/crm/WipWidget';
import { UpcomingThisWeekWidget } from '@/components/crm/UpcomingThisWeekWidget';
import { KeyAccountHealthWidget } from '@/components/crm/KeyAccountHealthWidget';
import { DealsAtRiskWidget } from '@/components/crm/DealsAtRiskWidget';
import { WinLossWidget } from '@/components/crm/WinLossWidget';

// /crm — the operational landing view of the CRM module.
//
// Stint 92 (post-CRM-audit): FirstTimeBanner removed — Diego is past
// onboarding and the banner was Rule §11 noise.
//
// Layout (priority order):
//   Forecast + WIP                          → money
//   Key-Account Health                      → relationships
//   Deals at Risk + Actions Due             → hot items
//   Upcoming This Week                      → week plan
//   Win/Loss reporting (YTD funnel signal)  → playbook insight
export default function CrmHomePage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-ink">CRM home</h1>
        {/* Stint 65.F — mental-model statement matching the one on
            /tax-ops. Two parallel surfaces; the user should never have
            to ask "which module owns this?". */}
        <p className="text-sm text-ink-muted mt-0.5">
          Commercial side. Pipeline forecast, unbilled work, Key Account health, deals at risk,
          actions due today, what&apos;s hitting this week. Compliance lives in Tax-Ops.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ForecastWidget />
        <WipWidget />
      </div>

      <KeyAccountHealthWidget />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <DealsAtRiskWidget />
        <ActionsDueWidget />
      </div>

      <UpcomingThisWeekWidget />

      <WinLossWidget />
    </div>
  );
}
