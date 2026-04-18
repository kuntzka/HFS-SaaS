FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS base
WORKDIR /app
EXPOSE 8080

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY ["src/HFS.Api/HFS.Api.csproj",          "src/HFS.Api/"]
COPY ["src/HFS.Application/HFS.Application.csproj", "src/HFS.Application/"]
COPY ["src/HFS.Infrastructure/HFS.Infrastructure.csproj", "src/HFS.Infrastructure/"]
COPY ["src/HFS.Domain/HFS.Domain.csproj",     "src/HFS.Domain/"]
RUN dotnet restore "src/HFS.Api/HFS.Api.csproj"
COPY . .
WORKDIR "/src/src/HFS.Api"
RUN dotnet build "HFS.Api.csproj" -c Release -o /app/build

FROM build AS publish
RUN dotnet publish "HFS.Api.csproj" -c Release -o /app/publish /p:UseAppHost=false

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "HFS.Api.dll"]
