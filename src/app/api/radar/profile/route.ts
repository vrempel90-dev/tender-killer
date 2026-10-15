/**
 * Профиль возможностей компании: что поставляем, где и на какие суммы.
 * По нему RADAR сопоставляет закупки с компанией.
 */

import { prisma } from '@/lib/db';
import { requireSession, requireWriteAccess } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonOk } from '@/lib/http';
import { readJson } from '@/lib/security/request';
import {
  ProfileSchema,
  profileCompleteness,
  toStoredProfile,
} from '@/lib/radar/profile';

function toResponse(profile: Awaited<ReturnType<typeof loadProfile>>) {
  if (!profile) {
    return {
      exists: false,
      keywords: [],
      excludedKeywords: [],
      regions: [],
      procurementTypes: [],
      minPrice: null,
      maxPrice: null,
      minDeliveryDays: null,
      excludedCustomerBins: [],
      preferredCustomerBins: [],
      minDaysToDeadline: null,
      notes: null,
      completeness: profileCompleteness(null),
    };
  }
  return {
    exists: true,
    keywords: profile.keywords,
    excludedKeywords: profile.excludedKeywords,
    regions: profile.regions,
    procurementTypes: profile.procurementTypes,
    // Наружу деньги отдаются в тенге: в тиын их хранит только БД.
    minPrice: profile.minPriceMinor === null ? null : Number(profile.minPriceMinor) / 100,
    maxPrice: profile.maxPriceMinor === null ? null : Number(profile.maxPriceMinor) / 100,
    minDeliveryDays: profile.minDeliveryDays,
    excludedCustomerBins: profile.excludedCustomerBins,
    preferredCustomerBins: profile.preferredCustomerBins,
    minDaysToDeadline: profile.minDaysToDeadline,
    notes: profile.notes,
    completeness: profileCompleteness(profile),
    updatedAt: profile.updatedAt,
  };
}

async function loadProfile(companyId: string) {
  return prisma.companyProfile.findUnique({ where: { companyId } });
}

export async function GET() {
  try {
    const session = await requireSession();
    return jsonOk(toResponse(await loadProfile(session.companyId)));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireWriteAccess();
    const input = ProfileSchema.parse(await readJson(request));
    const stored = toStoredProfile(input);

    const profile = await prisma.companyProfile.upsert({
      where: { companyId: session.companyId },
      create: { companyId: session.companyId, ...stored },
      update: stored,
    });

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'PROFILE_UPDATE',
      entity: 'CompanyProfile',
      entityId: profile.id,
      ipAddress: clientIp(request),
      metadata: {
        keywords: stored.keywords.length,
        regions: stored.regions.length,
      },
    });

    return jsonOk(toResponse(profile));
  } catch (error) {
    return handleApiError(error);
  }
}
