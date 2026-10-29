import { isDemo } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';

/** Permanent, unmissable notice that the data on screen is sample data. */
export function DemoBanner() {
  const { t } = useI18n();
  if (!isDemo) return null;
  return (
    <div className="sticky top-0 z-40 bg-coral-600 px-3 py-1.5 text-center text-xs font-medium text-white">
      {t('errors.demoBanner')}
    </div>
  );
}
