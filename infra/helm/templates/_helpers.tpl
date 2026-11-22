{{/*
SPDX-License-Identifier: AGPL-3.0-or-later

Shared parts of every workload. Each takes a dict with `root` (the chart's
context) and, where it applies, `component`.
*/}}

{{- define "tps.labels" -}}
app.kubernetes.io/name: tps
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
helm.sh/chart: tps-{{ .root.Chart.Version }}
{{- end }}

{{- define "tps.selector" -}}
app.kubernetes.io/name: tps
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "tps.image" -}}
{{ .repository }}@{{ .digest }}
{{- end }}

{{/* The browser-facing origin of a host, as the edge serves it. */}}
{{- define "tps.origin" -}}
https://{{ .host }}{{ if ne (int .root.Values.edge.httpsPort) 443 }}:{{ .root.Values.edge.httpsPort }}{{ end }}
{{- end }}

{{/*
The pod's own settings: a service account with no token and no RBAC
bindings, no service links, and the restricted Pod Security profile as uid
and gid 1000, the release images' node user. Secret files are group 1000.
*/}}
{{- define "tps.pod" -}}
serviceAccountName: {{ .component }}
automountServiceAccountToken: false
enableServiceLinks: false
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 1000
  fsGroup: 1000
  seccompProfile:
    type: RuntimeDefault
{{- with .root.Values.imagePullSecrets }}
imagePullSecrets:
  {{- range . }}
  - name: {{ . }}
  {{- end }}
{{- end }}
{{- end }}

{{- define "tps.container" -}}
imagePullPolicy: IfNotPresent
securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: [ALL]
{{- end }}

{{/* The one writable folder, and the ServiceAccount every workload gets. */}}
{{- define "tps.tmpVolume" -}}
- name: tmp
  emptyDir:
    sizeLimit: 64Mi
{{- end }}

{{- define "tps.serviceAccount" -}}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ .component }}
  labels:
    {{- include "tps.labels" . | nindent 4 }}
automountServiceAccountToken: false
{{- end }}

{{/*
The pod's secrets, as files under /run/secrets readable by group 1000 alone
(mode 0440). `files` maps each file name to its key under .Values.secrets;
each Secret holds its value under `value`.
*/}}
{{- define "tps.secretsVolume" -}}
- name: secrets
  projected:
    defaultMode: 288
    sources:
      {{- range $file, $key := .files }}
      - secret:
          name: {{ index $.root.Values.secrets $key }}
          items:
            - key: value
              path: {{ $file }}
      {{- end }}
{{- end }}

{{/* CA certificates, which are not secret: the database's, and any extra ones. */}}
{{- define "tps.caVolume" -}}
- name: ca
  projected:
    defaultMode: 292
    sources:
      - configMap:
          name: {{ .root.Values.database.ca.configMap }}
          items:
            - key: {{ .root.Values.database.ca.key }}
              path: database.crt
      {{- with .root.Values.extraCaCertificates }}
      {{- if .configMap }}
      - configMap:
          name: {{ .configMap }}
          items:
            - key: {{ .key }}
              path: extra.crt
      {{- end }}
      {{- end }}
{{- end }}

{{- define "tps.mounts" -}}
- name: tmp
  mountPath: /tmp
- name: secrets
  mountPath: /run/secrets
  readOnly: true
- name: ca
  mountPath: /etc/tps/ca
  readOnly: true
{{- end }}

{{/* Every connection uses TLS (S11-28): in Kubernetes the database is never on loopback. */}}
{{- define "tps.databaseEnv" -}}
- name: TPS_DB_HOST
  value: {{ .Values.database.host | quote }}
- name: TPS_DB_PORT
  value: {{ .Values.database.port | quote }}
- name: TPS_DB_NAME
  value: {{ .Values.database.name | quote }}
- name: TPS_DB_TLS
  value: verify-full
- name: TPS_DB_TLS_CA_FILE
  value: /etc/tps/ca/database.crt
{{- if .Values.extraCaCertificates.configMap }}
- name: NODE_EXTRA_CA_CERTS
  value: /etc/tps/ca/extra.crt
{{- end }}
{{- end }}

{{/* Storage, mail and clamd, for the API and the worker. */}}
{{- define "tps.servicesEnv" -}}
- name: TPS_STORAGE_ENDPOINT
  value: {{ .Values.storage.endpoint | quote }}
- name: TPS_STORAGE_REGION
  value: {{ .Values.storage.region | quote }}
- name: TPS_STORAGE_BUCKET
  value: {{ .Values.storage.bucket | quote }}
- name: TPS_STORAGE_WRITE_ACCESS_KEY_ID
  value: {{ .Values.storage.accessKeyIds.write | quote }}
- name: TPS_STORAGE_WRITE_SECRET_ACCESS_KEY_FILE
  value: /run/secrets/storage_write_secret_key
- name: TPS_STORAGE_READ_ACCESS_KEY_ID
  value: {{ .Values.storage.accessKeyIds.read | quote }}
- name: TPS_STORAGE_READ_SECRET_ACCESS_KEY_FILE
  value: /run/secrets/storage_read_secret_key
- name: TPS_STORAGE_SCANNER_ACCESS_KEY_ID
  value: {{ .Values.storage.accessKeyIds.scanner | quote }}
- name: TPS_STORAGE_SCANNER_SECRET_ACCESS_KEY_FILE
  value: /run/secrets/storage_scanner_secret_key
- name: TPS_SMTP_HOST
  value: {{ .Values.smtp.host | quote }}
- name: TPS_SMTP_PORT
  value: {{ .Values.smtp.port | quote }}
- name: TPS_SMTP_TLS
  value: {{ .Values.smtp.tls | quote }}
- name: TPS_SMTP_FROM
  value: {{ .Values.smtp.from | quote }}
{{- if .Values.smtp.user }}
- name: TPS_SMTP_USER
  value: {{ .Values.smtp.user | quote }}
- name: TPS_SMTP_PASSWORD_FILE
  value: /run/secrets/smtp_password
{{- end }}
- name: TPS_CLAMD_HOST
  value: {{ .Values.clamd.host | quote }}
- name: TPS_CLAMD_PORT
  value: {{ .Values.clamd.port | quote }}
# ADR 0047: 5 seconds after clamd's MaxScanTime.
- name: TPS_CLAMD_TIMEOUT_MS
  value: '25000'
- name: TPS_FILES_MAX_STORES
  value: '4'
- name: TPS_SUBJECT_KEK_FILE
  value: /run/secrets/subject_kek
- name: TPS_SUBJECT_KEK_VERSION
  value: {{ .Values.subjectKekVersion | quote }}
- name: TPS_PORTAL_ORIGIN
  value: {{ include "tps.origin" (dict "root" . "host" .Values.hosts.portal) | quote }}
{{- end }}
