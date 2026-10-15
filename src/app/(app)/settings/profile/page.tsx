import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { canWrite } from '@/lib/auth/guard';
import { requirePageSession } from '@/lib/auth/page-guard';
import { PageHeader } from '@/components/layout/page-header';
import { profileCompleteness } from '@/lib/radar/profile';
import { ProfileForm } from './profile-form';

export const metadata: Metadata = { title: 'Профиль компании' };

export default async function ProfilePage() {
  const session = await requirePageSession();

  const profile = await prisma.companyProfile.findUnique({
    where: { companyId: session.companyId },
  });

  return (
    <>
      <PageHeader
        title="Профиль возможностей компании"
        description={
          'По этому профилю TENDER RADAR сопоставляет закупки с тем, что компания '
          + 'реально может поставить. Профиль заполняется вручную и не выводится '
          + 'автоматически: догадка о возможностях компании привела бы к тому, что '
          + 'часть подходящих закупок молча исчезала бы из поиска.'
        }
      />
      <div className="flex-1 px-5 py-5 sm:px-7">
        <ProfileForm
          canEdit={canWrite(session.role)}
          initial={{
            keywords: profile?.keywords ?? [],
            excludedKeywords: profile?.excludedKeywords ?? [],
            regions: profile?.regions ?? [],
            procurementTypes: profile?.procurementTypes ?? [],
            minPrice:
              profile?.minPriceMinor === null || profile?.minPriceMinor === undefined
                ? null
                : Number(profile.minPriceMinor) / 100,
            maxPrice:
              profile?.maxPriceMinor === null || profile?.maxPriceMinor === undefined
                ? null
                : Number(profile.maxPriceMinor) / 100,
            minDeliveryDays: profile?.minDeliveryDays ?? null,
            excludedCustomerBins: profile?.excludedCustomerBins ?? [],
            preferredCustomerBins: profile?.preferredCustomerBins ?? [],
            minDaysToDeadline: profile?.minDaysToDeadline ?? null,
            notes: profile?.notes ?? null,
          }}
          completeness={profileCompleteness(profile)}
        />
      </div>
    </>
  );
}
