//#region lib/types/index.js
/**
 * ModelRoute 配置面板，宿主半边。空 apply 只为让插件出现在 Loader 组合里；
 * 浏览器半边通过 exports["./client"] 交付（package.json 的 dsh.client 声明），
 * 在 Models 设置页的 provider 卡片上渲染本网关的可视化配置。
 */
function apply() {}
//#endregion
export { apply };
