{{- define "fixer-tenant.fullname" -}}
{{ required "tenant.slug is required (e.g. \"oficina-silva\")" .Values.tenant.slug }}
{{- end -}}

{{- define "fixer-tenant.labels" -}}
app.kubernetes.io/part-of: fixer
fixer.io/tenant: {{ .Values.tenant.slug }}
{{- end -}}

{{/*
Imagem do notifications. Padrão (legado): "<image.repository>-notifications:<image.tag>" (build do monorepo do Fixer).
Com notifications.image.repository definido, usa a imagem da plataforma Max Gateway (ex.: ECR max-gateway/notifications) e exige a tag semver.
*/}}
{{- define "fixer-tenant.notificationsImage" -}}
{{- $img := .Values.notifications.image | default dict -}}
{{- if $img.repository -}}
{{ $img.repository }}:{{ required "notifications.image.tag é obrigatório quando notifications.image.repository é definido" $img.tag }}
{{- else -}}
{{ .Values.image.repository }}-notifications:{{ .Values.image.tag }}
{{- end -}}
{{- end }}
