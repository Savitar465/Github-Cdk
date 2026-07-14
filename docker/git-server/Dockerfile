# Imagen derivada del git-server con el fix de rama inicial:
# git-admin.cgi (creación de repos vía HTTP) inicializaba los bare repos con
# HEAD → master, mientras que la aplicación usa main. JGit no podía clonar
# ("Remote branch 'HEAD' not found in upstream origin") y las lecturas de
# contenido devolvían 500.
FROM cfulano/git-ssh-http-server:latest

COPY git-admin.cgi /usr/local/bin/git-admin.cgi
RUN chmod +x /usr/local/bin/git-admin.cgi
