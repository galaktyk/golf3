import * as THREE from 'three';

export function configureUnlitMaterials(root) {
  root.traverse((node) => {
    if (!node.isMesh) {
      return;
    }

    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const unlitMaterials = materials.map((material) => createUnlitMaterial(material));

    node.material = Array.isArray(node.material) ? unlitMaterials : unlitMaterials[0];
  });
}

export function configureFlatShadedMaterials(root) {
  root.traverse((node) => {
    if (!node.isMesh) {
      return;
    }

    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const flatShadedMaterials = materials.map((material) => createFlatShadedMaterial(material));

    node.material = Array.isArray(node.material) ? flatShadedMaterials : flatShadedMaterials[0];
  });
}

function createUnlitMaterial(sourceMaterial) {
  if (!sourceMaterial) {
    return new THREE.MeshBasicMaterial({ color: '#ffffff' });
  }

  const hasAlphaTexture = Boolean(sourceMaterial.map || sourceMaterial.alphaMap);
  const isTransparent = sourceMaterial.transparent || sourceMaterial.opacity < 1;
  const alphaTest = hasAlphaTexture && !isTransparent
    ? Math.max(sourceMaterial.alphaTest ?? 0, 0.01)
    : 0;

  return new THREE.MeshBasicMaterial({
    name: sourceMaterial.name,
    color: sourceMaterial.color?.clone() ?? new THREE.Color('#ffffff'),
    map: sourceMaterial.map ?? null,
    alphaMap: sourceMaterial.alphaMap ?? null,
    side: sourceMaterial.side,
    transparent: isTransparent,
    opacity: sourceMaterial.opacity,
    alphaTest,
    depthWrite: !isTransparent,
  });
}

function createFlatShadedMaterial(sourceMaterial) {
  if (!sourceMaterial) {
    return new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true });
  }

  const hasAlphaTexture = Boolean(sourceMaterial.map || sourceMaterial.alphaMap);
  const isTransparent = sourceMaterial.transparent || sourceMaterial.opacity < 1;
  const alphaTest = hasAlphaTexture && !isTransparent
    ? Math.max(sourceMaterial.alphaTest ?? 0, 0.01)
    : 0;

  return new THREE.MeshLambertMaterial({
    name: sourceMaterial.name,
    color: sourceMaterial.color?.clone() ?? new THREE.Color('#ffffff'),
    map: sourceMaterial.map ?? null,
    alphaMap: sourceMaterial.alphaMap ?? null,
    side: sourceMaterial.side,
    transparent: isTransparent,
    opacity: sourceMaterial.opacity,
    alphaTest,
    depthWrite: !isTransparent,
    flatShading: true,
  });
}