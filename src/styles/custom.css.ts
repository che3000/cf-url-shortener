export const CUSTOM_CSS = `
:root{--radius:.75rem}
.card{border-radius:var(--radius);border:1px solid rgb(226 232 240);background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.btn{border:1px solid rgb(203 213 225);border-radius:.6rem;padding:.5rem .9rem}
.btn-primary{background:#000;color:#fff;border-color:#000}
.btn:hover{opacity:.9}
.badge{display:inline-flex;align-items:center;gap:.35rem;border-radius:999px;padding:.2rem .6rem;font-size:.75rem;line-height:1}
.badge.green{background:#10b98122;color:#065f46;border:1px solid #10b98155}
.badge.amber{background:#f59e0b22;color:#78350f;border:1px solid #f59e0b55}
.badge.red{background:#ef444422;color:#7f1d1d;border:1px solid #ef444455}
.badge.gray{background:#64748b22;color:#0f172a;border:1px solid #64748b55}
.link{color:#1d4ed8;text-decoration:underline;text-underline-offset:2px}
.kbd{border:1px solid rgb(203 213 225);border-bottom-width:2px;border-radius:.4rem;padding:.15rem .4rem;font-size:.75rem;background:#f8fafc}
th[data-sort]{cursor:pointer}
.modal{position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:50}
.modal-content{background:#fff;border-radius:0.5rem;padding:1.5rem;max-width:28rem;width:90%}
.edit-icon{cursor:pointer;color:#64748b;transition:color 0.2s}
.edit-icon:hover{color:#1d4ed8}
.container-wrapper{width:100%;max-width:100%}
@media (min-width:640px){.container-wrapper{max-width:65%}}
table{font-size:12px;table-layout:auto}
@media (min-width:640px){table{font-size:16px}}
table th, table td{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
table th:nth-child(2), table td:nth-child(2){white-space:normal;word-break:break-all;max-width:200px}
@media (min-width:768px){table th:nth-child(2), table td:nth-child(2){max-width:none}}
.toast{position:fixed;bottom:2rem;right:2rem;color:#fff;padding:1rem 1.5rem;border-radius:0.5rem;box-shadow:0 10px 15px -3px rgba(0,0,0,0.1),0 4px 6px -2px rgba(0,0,0,0.05);display:flex;align-items:center;gap:0.75rem;z-index:100;animation:slideIn 0.3s ease-out}
.toast.success{background:#10b981}
.toast.error{background:#ef4444}
@keyframes slideIn{from{transform:translateX(120%);opacity:0}to{transform:translateX(0);opacity:1}}
.toast.hide{animation:slideOut 0.3s ease-in forwards}
@keyframes slideOut{from{transform:translateX(0);opacity:1}to{transform:translateX(120%);opacity:0}}
`;
