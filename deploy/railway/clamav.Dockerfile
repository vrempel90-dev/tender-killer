# Official feature-release tag receives signature/security updates. Pin digest
# after staging verification; persistent signature volume avoids full re-download.
FROM clamav/clamav:1.5_base
COPY deploy/railway/clamd.conf /etc/clamav/clamd.conf
# Official init handles FreshClam, ownership and starts the real daemon.
# No public domain or TCP proxy; mount /var/lib/clamav persistently.
