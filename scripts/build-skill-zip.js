// Empaqueta la skill signframe-form-def en public/ para que se pueda bajar
// desde el hub 2.0. La version y la fecha salen del JSON que escribe este
// script, no del HTML: para publicar una version nueva se corre esto y listo.
//
//   node scripts/build-skill-zip.js <carpeta-de-la-skill> [version]

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const SALIDA = path.join(__dirname, '..', 'public');
const NOMBRE = 'skill-signframe-form-def';

function archivosDe(dir, base) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const abs = path.join(dir, e.name);
        const rel = path.posix.join(base, e.name);
        return e.isDirectory() ? archivosDe(abs, rel) : [{ abs, rel }];
    });
}

async function main() {
    const origen = process.argv[2];
    const version = process.argv[3] || '1.0.0';
    if (!origen || !fs.existsSync(path.join(origen, 'SKILL.md'))) {
        console.error('Falta la carpeta de la skill (la que tiene SKILL.md).');
        process.exit(1);
    }

    const zip = new JSZip();
    const archivos = archivosDe(origen, 'signframe-form-def');
    archivos.forEach((a) => zip.file(a.rel, fs.readFileSync(a.abs)));

    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.mkdirSync(SALIDA, { recursive: true });
    fs.writeFileSync(path.join(SALIDA, NOMBRE + '.zip'), buf);
    fs.writeFileSync(path.join(SALIDA, NOMBRE + '.json'), JSON.stringify({
        version: version,
        fecha: new Date().toISOString().slice(0, 10),
        archivo: NOMBRE + '.zip',
        bytes: buf.length,
        archivos: archivos.length,
    }, null, 2) + '\n');

    console.log(`${archivos.length} archivos -> ${NOMBRE}.zip (${(buf.length / 1024).toFixed(0)} KB) v${version}`);
}

main();
