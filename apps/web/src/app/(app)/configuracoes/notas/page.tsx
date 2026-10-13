import { redirect } from 'next/navigation';

// O cadastro foi unificado em /configuracoes; mantém links antigos funcionando.
export default function Page() {
  redirect('/configuracoes');
}
